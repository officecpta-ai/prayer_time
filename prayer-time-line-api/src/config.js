function getConfig() {
  const port = parseInt(process.env.PORT || '8080', 10);

  // 用來產生 web view 絕對網址（LINE 文字訊息需提供可點擊的完整 URL）
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

  // LINE secrets
  const lineChannelSecret = process.env.LINE_CHANNEL_SECRET || '';
  const lineChannelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

  // Web view signing secret
  const viewLinkSecret = process.env.VIEW_LINK_SECRET || '';

  // OpenAI（用於 embeddings 與 QA 回答）
  const openaiApiKey = process.env.OPENAI_API_KEY || '';
  const openaiEmbedModel = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
  const openaiQaModel = process.env.OPENAI_QA_MODEL || 'gpt-4.1-mini';

  // Vertex AI Vector Search（用於整本手冊檢索）
  const vertexProjectId = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
  const vertexLocation = process.env.VERTEX_LOCATION || 'asia-northeast1';
  const vertexIndexId = process.env.VERTEX_INDEX_ID || '';
  const vertexIndexEndpointId = process.env.VERTEX_INDEX_ENDPOINT_ID || '';
  const vertexDeployedIndexId = process.env.VERTEX_DEPLOYED_INDEX_ID || '';
  const vertexPublicEndpointDomain = process.env.VERTEX_PUBLIC_ENDPOINT_DOMAIN || '';

  // Ragic
  const ragicBaseUrl = (process.env.RAGIC_BASE_URL || 'https://ap13.ragic.com/asiahope').replace(/\/$/, '');
  const ragicApiKey = process.env.RAGIC_API_KEY || '';
  const ragicApiKeyInQuery = process.env.RAGIC_API_KEY_IN_QUERY === 'true';
  const ragicBasicRaw = process.env.RAGIC_BASIC_RAW === 'true';

  // 訂閱表單（給 LINE 使用者點擊）
  // 參考：Ragic pfv[field_id]=value 可預填欄位
  // https://www.ragic.com/intl/en/doc-kb/343/auto-fill-specific-fields-with-predefined-values-in-embedded-database-form
  const ragicSubscribeFormUrl =
    process.env.RAGIC_SUBSCRIBE_FORM_URL ||
    'https://ap13.ragic.com/asiahope/gpt/4?ragic-web-embed=true&webaction=form&ver=new&version=2';

  // gpt/7 閱讀紀錄表欄位 ID（用於 POST 寫入）；姓名 1011771、教會 1011772
  const readingRecordFieldIds = {
    line_user_id: process.env.RAGIC_READING_RECORD_FIELD_LINE_USER_ID || '1011768',
    line_display_name: process.env.RAGIC_READING_RECORD_FIELD_LINE_DISPLAY_NAME || '',
    user_email: process.env.RAGIC_READING_RECORD_FIELD_USER_EMAIL || '1011761',
    book_id: process.env.RAGIC_READING_RECORD_FIELD_BOOK_ID || '1011762',
    book_name: process.env.RAGIC_READING_RECORD_FIELD_BOOK_NAME || '1011763',
    reading_day: process.env.RAGIC_READING_RECORD_FIELD_READING_DAY || '1011764',
    read_time: process.env.RAGIC_READING_RECORD_FIELD_READ_TIME || '1011765',
    user_name: process.env.RAGIC_READING_RECORD_FIELD_USER_NAME || '1011771',
    church: process.env.RAGIC_READING_RECORD_FIELD_CHURCH || '1011772',
  };

  // gpt/4 訂閱表欄位（姓名 1011599、教會 1011773，供寫入閱讀紀錄時帶入）
  const subscriptionFieldIds = {
    line_user_id: process.env.RAGIC_SUBSCRIPTION_FIELD_LINE_USER_ID || '1011767',
    book_id: process.env.RAGIC_SUBSCRIPTION_FIELD_BOOK_ID || '1011596',
    is_active: process.env.RAGIC_SUBSCRIPTION_FIELD_IS_ACTIVE || '1011597',
    user_name: process.env.RAGIC_SUBSCRIPTION_FIELD_USER_NAME || '1011599',
    church: process.env.RAGIC_SUBSCRIPTION_FIELD_CHURCH || '1011773',
  };

  return {
    port,
    publicBaseUrl,
    lineChannelSecret,
    lineChannelAccessToken,
    viewLinkSecret,
    openaiApiKey,
    openaiEmbedModel,
    openaiQaModel,
    vertexProjectId,
    vertexLocation,
    vertexIndexId,
    vertexIndexEndpointId,
    vertexDeployedIndexId,
    vertexPublicEndpointDomain,
    ragicBaseUrl,
    ragicApiKey,
    ragicApiKeyInQuery,
    ragicBasicRaw,
    ragicSubscribeFormUrl,
    readingRecordFieldIds,
    subscriptionFieldIds,
  };
}

module.exports = { getConfig };

