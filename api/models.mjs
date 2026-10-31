import { modelsResponse } from '../lib/chat.mjs';
export default { fetch: () => modelsResponse(process.env) };
