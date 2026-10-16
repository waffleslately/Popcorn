import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { createServer } from './server';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const { server } = createServer();

server.listen(port, '0.0.0.0', () => {
  console.log(`🍿 Popcorn server listening on port ${port}`);
});

export default server;
