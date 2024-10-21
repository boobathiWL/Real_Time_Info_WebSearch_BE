import express from 'express';
import cors from 'cors';
import http from 'http';
import routes from './routes';
import { getMongoDBURI, getPort } from './config';
import logger from './utils/logger';
import * as mongoose from 'mongoose';

const port = getPort();
const MONGO_URI = getMongoDBURI();

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: '*',
};

app.use(cors(corsOptions));
app.use(express.json());

app.use('/api', routes);
app.get('/api', (_, res) => {
  res.status(200).json({ status: 'ok' });
});

//mongodb connect
mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('connected to atlas mongodb');
  })
  .catch((err) => {
    console.error(err);
  });

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});

process.on('uncaughtException', (err, origin) => {
  logger.error(`Uncaught Exception at ${origin}: ${err}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});
