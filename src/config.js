/**
 * 讀取環境變數：PORT、Ragic 基礎網址與 API Key、訂閱表單連結
 */
function getConfig() {
  const baseUrl = process.env.RAGIC_BASE_URL || 'https://ap13.ragic.com/asiahope';
  const apiKey = process.env.RAGIC_API_KEY || '';
  const subscriptionFormUrl =
    process.env.RAGIC_SUBSCRIPTION_FORM_URL || 'https://ap13.ragic.com/asiahope/gpt/4?ragic-web-embed=true&webaction=form&ver=new&version=2';

  if (!apiKey) {
    console.warn('RAGIC_API_KEY 未設定，Ragic 請求可能失敗');
  }

  const apiKeyInQuery = process.env.RAGIC_API_KEY_IN_QUERY === 'true';
  const basicRaw = process.env.RAGIC_BASIC_RAW === 'true';

  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

  // Ragic 閱讀紀錄表（gpt/7）：每次閱讀寫入一筆；姓名 1011771、教會 1011772
  const readingRecordFieldIds = {
    user_email: process.env.RAGIC_READING_RECORD_FIELD_USER_EMAIL || '1011761',
    book_id: process.env.RAGIC_READING_RECORD_FIELD_BOOK_ID || '1011762',
    book_name: process.env.RAGIC_READING_RECORD_FIELD_BOOK_NAME || '1011763',
    reading_day: process.env.RAGIC_READING_RECORD_FIELD_READING_DAY || '1011764',
    read_time: process.env.RAGIC_READING_RECORD_FIELD_READ_TIME || '1011765',
    user_name: process.env.RAGIC_READING_RECORD_FIELD_USER_NAME || '1011771',
    church: process.env.RAGIC_READING_RECORD_FIELD_CHURCH || '1011772',
  };

  // Ragic 訂閱表（gpt/4）欄位 ID（表單：禱告手冊訂閱 ap13.ragic.com/asiahope/gpt/4）
  // 姓名=1011599, email=1011595, 選擇訂閱書本=1011596, 書名=1011603, is_active=1011597, 教會=1011773
  const subscriptionFieldIds = {
    user_name: process.env.RAGIC_SUBSCRIPTION_FIELD_USER_NAME || '1011599',
    user_email: process.env.RAGIC_SUBSCRIPTION_FIELD_USER_EMAIL || '1011595',
    book_id: process.env.RAGIC_SUBSCRIPTION_FIELD_BOOK_ID || '1011596',
    book_name: process.env.RAGIC_SUBSCRIPTION_FIELD_BOOK_NAME || '1011603',
    is_active: process.env.RAGIC_SUBSCRIPTION_FIELD_IS_ACTIVE || '1011597',
    church: process.env.RAGIC_SUBSCRIPTION_FIELD_CHURCH || '1011773',
  };

  // Ragic 對話紀錄表（gpt/10）：紀錄時間 1011812, email 1011813, 姓名 1011814, 角色 1011817, 訊息內容 1011815, 對話ID 1011818
  const conversationLogFieldIds = {
    record_time: process.env.RAGIC_CONVERSATION_FIELD_RECORD_TIME || '1011812',
    email: process.env.RAGIC_CONVERSATION_FIELD_EMAIL || '1011813',
    user_name: process.env.RAGIC_CONVERSATION_FIELD_USER_NAME || '1011814',
    role: process.env.RAGIC_CONVERSATION_FIELD_ROLE || '1011817',
    message: process.env.RAGIC_CONVERSATION_FIELD_MESSAGE || '1011815',
    conversation_id: process.env.RAGIC_CONVERSATION_FIELD_CONVERSATION_ID || '1011818',
  };

  return {
    ragicBaseUrl: baseUrl.replace(/\/$/, ''),
    ragicApiKey: apiKey,
    ragicApiKeyInQuery: apiKeyInQuery,
    ragicBasicRaw: basicRaw,
    subscriptionFormUrl,
    port: parseInt(process.env.PORT || '8080', 10),
    googleClientId,
    googleClientSecret,
    publicBaseUrl,
    readingRecordFieldIds,
    subscriptionFieldIds,
    conversationLogFieldIds,
  };
}

module.exports = { getConfig };
