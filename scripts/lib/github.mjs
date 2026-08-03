// Minimal GitHub REST + GraphQL client for workflow scripts. Dependency-free
// (global fetch) so data workflows never need `npm ci`.

const API = 'https://api.github.com';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class GitHub {
  constructor({ token, owner, repo }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
  }

  async #request(url, init, attempt = 0) {
    const res = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
    // Retry on server errors and secondary rate limits.
    if ((res.status >= 500 || res.status === 403 || res.status === 429) && attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (res.status >= 500 || retryAfter || remaining === '0' || res.status === 429) {
        const wait = retryAfter ? retryAfter * 1000 : 2000 * 2 ** attempt;
        console.warn(`  github ${res.status}, retrying in ${wait}ms`);
        await sleep(wait);
        return this.#request(url, init, attempt + 1);
      }
    }
    return res;
  }

  async rest(method, path, body) {
    const res = await this.#request(`${API}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404) return { status: 404, data: null };
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${await res.text()}`);
    }
    return { status: res.status, data: res.status === 204 ? null : await res.json() };
  }

  async graphql(query, variables) {
    const res = await this.#request(`${API}/graphql`, {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL -> ${res.status}: ${await res.text()}`);
    const payload = await res.json();
    // Partial data with errors is fine for resource() lookups on missing repos.
    if (payload.errors && !payload.data) {
      throw new Error(`GitHub GraphQL errors: ${JSON.stringify(payload.errors).slice(0, 500)}`);
    }
    return payload.data;
  }

  async paginate(path, params = {}) {
    const all = [];
    for (let page = 1; ; page++) {
      const search = new URLSearchParams({ ...params, per_page: '100', page: String(page) });
      const { data } = await this.rest('GET', `${path}?${search}`);
      if (!data?.length) break;
      all.push(...data);
      if (data.length < 100) break;
    }
    return all;
  }

  listOpenIssuesByLabel(label) {
    return this.paginate(`/repos/${this.owner}/${this.repo}/issues`, {
      state: 'open',
      labels: label,
      sort: 'created',
      direction: 'asc',
    });
  }

  async getIssue(number) {
    const { data } = await this.rest('GET', `/repos/${this.owner}/${this.repo}/issues/${number}`);
    return data;
  }

  listComments(number) {
    return this.paginate(`/repos/${this.owner}/${this.repo}/issues/${number}/comments`);
  }

  async comment(number, body) {
    await this.rest('POST', `/repos/${this.owner}/${this.repo}/issues/${number}/comments`, { body });
  }

  async addLabels(number, labels) {
    await this.rest('POST', `/repos/${this.owner}/${this.repo}/issues/${number}/labels`, { labels });
  }

  async closeIssue(number, stateReason) {
    await this.rest('PATCH', `/repos/${this.owner}/${this.repo}/issues/${number}`, {
      state: 'closed',
      state_reason: stateReason,
    });
  }

  /** Create a label if it doesn't exist yet (no-op on 422 already-exists). */
  async ensureLabel(name, color, description) {
    try {
      await this.rest('POST', `/repos/${this.owner}/${this.repo}/labels`, {
        name,
        color,
        description,
      });
    } catch (err) {
      if (!String(err.message).includes('422')) throw err;
    }
  }

  /** True if the user has write access to the tracker repo (staff). */
  async isStaff(username) {
    const { status, data } = await this.rest(
      'GET',
      `/repos/${this.owner}/${this.repo}/collaborators/${encodeURIComponent(username)}/permission`,
    );
    if (status === 404 || !data) return false;
    return ['admin', 'maintain', 'write'].includes(data.permission);
  }

  /** Live state of an upstream issue: { state: 'open'|'closed'|'missing', assigned }. */
  async fetchIssueLive(url) {
    const data = await this.graphql(
      `query ($url: URI!) {
        resource(url: $url) {
          __typename
          ... on Issue { state assignees(first: 1) { totalCount } }
        }
      }`,
      { url },
    );
    const node = data?.resource;
    if (!node || node.__typename !== 'Issue') return { state: 'missing', assigned: false };
    return {
      state: node.state === 'OPEN' ? 'open' : 'closed',
      assigned: (node.assignees?.totalCount ?? 0) > 0,
    };
  }
}
