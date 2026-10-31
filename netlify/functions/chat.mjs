import { chatResponse } from '../../lib/chat.mjs';

export default (request) => chatResponse(request, process.env);

export const config = { path: '/api/chat' };
