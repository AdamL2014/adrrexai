import { chatResponse } from '../lib/chat.mjs';
export default { fetch: (request) => chatResponse(request, process.env) };
