import express from 'express';
import webSearchRouter from './webSearch'

const router = express.Router();
router.use('/websearch', webSearchRouter);

export default router;
