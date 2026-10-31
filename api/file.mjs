import { fileResponse } from '../lib/chat.mjs';
export default { fetch: (request) => fileResponse(request, process.env) };
