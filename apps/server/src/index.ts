import dotenv from 'dotenv';
dotenv.config();

import { createServer } from './server';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
const { server } = createServer();

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`🍿 Popcorn server listening on port ${port}`);
});

export default server;
