import { modelsResponse } from '../../lib/chat.mjs';

export default () => modelsResponse(process.env);

export const config = { path: '/api/models' };
