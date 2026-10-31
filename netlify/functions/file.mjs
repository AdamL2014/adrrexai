import { fileResponse } from '../../lib/chat.mjs';

export default (request) => fileResponse(request, process.env);

export const config = { path: '/api/file' };
