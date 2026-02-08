const { GoogleAuth } = require('google-auth-library');
const { getConfig } = require('./config');

let _auth = null;
function getAuth() {
  if (_auth) return _auth;
  _auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return _auth;
}

function createTimeoutSignal(timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return { signal: undefined, cancel: () => {} };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

function combineSignals(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ac = new AbortController();
  const onAbort = () => {
    try {
      ac.abort(new Error('aborted'));
    } catch {
      // ignore
    }
  };
  if (a.aborted || b.aborted) onAbort();
  else {
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });
  }
  return ac.signal;
}

async function getAccessToken() {
  const client = await getAuth().getClient();
  const token = await client.getAccessToken();
  return token?.token || token;
}

async function vertexFindNeighbors({ queryVector, neighborCount = 5, timeoutMs, signal }) {
  const {
    vertexProjectId,
    vertexLocation,
    vertexIndexEndpointId,
    vertexDeployedIndexId,
    vertexPublicEndpointDomain,
  } = getConfig();

  if (!vertexProjectId || !vertexIndexEndpointId || !vertexDeployedIndexId || !vertexPublicEndpointDomain) {
    throw new Error('VERTEX_* env 未設定完整');
  }

  const accessToken = await getAccessToken();
  const url = `https://${vertexPublicEndpointDomain}/v1/projects/${vertexProjectId}/locations/${vertexLocation}/indexEndpoints/${vertexIndexEndpointId}:findNeighbors`;
  const body = {
    deployed_index_id: vertexDeployedIndexId,
    queries: [
      {
        datapoint: {
          datapoint_id: 'q',
          feature_vector: queryVector,
        },
        neighbor_count: neighborCount,
      },
    ],
  };
  const ts = createTimeoutSignal(timeoutMs);
  const res = await fetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: combineSignals(signal, ts.signal),
    }
  ).finally(() => ts.cancel());
  if (!res.ok) throw new Error(`vertex_findneighbors_error_${res.status}`);
  const data = await res.json();
  const neighbors = data?.nearestNeighbors?.[0]?.neighbors || data?.nearest_neighbors?.[0]?.neighbors || [];
  return neighbors
    .map((n) => ({
      id: String(n.datapoint?.datapointId || n.datapoint_id || n.id || ''),
      distance: typeof n.distance === 'number' ? n.distance : Number(n.distance),
    }))
    .filter((x) => x.id);
}

async function vertexUpsertDatapoints({ indexId, datapoints }) {
  const { vertexProjectId, vertexLocation } = getConfig();
  if (!vertexProjectId) throw new Error('VERTEX_PROJECT_ID 未設定');
  if (!indexId) throw new Error('indexId required');
  if (!Array.isArray(datapoints) || datapoints.length === 0) return;

  const accessToken = await getAccessToken();
  const url = `https://${vertexLocation}-aiplatform.googleapis.com/v1/projects/${vertexProjectId}/locations/${vertexLocation}/indexes/${indexId}:upsertDatapoints`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ datapoints }),
  });
  if (!res.ok) throw new Error(`vertex_upsert_error_${res.status}`);
}

module.exports = {
  vertexFindNeighbors,
  vertexUpsertDatapoints,
};

