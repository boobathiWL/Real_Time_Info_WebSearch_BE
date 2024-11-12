import express from 'express';
import logger from '../utils/logger';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '../lib/providers';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { BaseMessage, AIMessage, HumanMessage } from '@langchain/core/messages';
import handleWebSearch from '../agents/webSearchAgentWithoutWS';
const router = express.Router();

const searchHandlers = {
  webSearch: handleWebSearch,
};

router.post('/', async (req, res) => {
  try {
    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    const chatModelProvider = Object.keys(chatModelProviders)[0];
    const chatModel = Object.keys(chatModelProviders[chatModelProvider])[3];

    const embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
    const embeddingModel = Object.keys(
      embeddingModelProviders[embeddingModelProvider],
    )[0];

    let llm: BaseChatModel | undefined;
    let embeddings: Embeddings | undefined;

    if (
      chatModelProviders[chatModelProvider] &&
      chatModelProviders[chatModelProvider][chatModel] &&
      chatModelProvider != 'custom_openai'
    ) {
      llm = chatModelProviders[chatModelProvider][chatModel] as unknown as
        | BaseChatModel
        | undefined;
    }

    if (
      embeddingModelProviders[embeddingModelProvider] &&
      embeddingModelProviders[embeddingModelProvider][embeddingModel]
    ) {
      embeddings = embeddingModelProviders[embeddingModelProvider][
        embeddingModel
      ] as Embeddings | undefined;
    }

    if (!llm || !embeddings) {
      return res.status(400).json({
        type: 'error',
        data: 'Invalid LLM or embeddings model selected, please refresh the page and try again.',
        key: 'INVALID_MODEL_SELECTED',
      });
    }

    const message = req.body.title ? req.body.title.toString() : req.body.urls;
    const source = req.body.source ?? '';
    if (source !== 'section' && source !== 'title') {
      return res.status(404).json({ message: 'Source field is required' });
    }
    if (!req.body.type) {
      return res.status(400).json({
        message: 'Type field is required',
      });
    }
    const type = req.body.type.toString();

    if (!message) {
      return res.status(400).json({
        message: `${type == 'url' ? 'Title' : 'URLS'} field is required`,
      });
    }

    let historyContent = [];

    if (type == 'url') {
      const parsedWSMessage = {
        type: 'message',
        message: {
          content: message,
        },
        focusMode: 'webSearch',
        history: [['human', message]],
      };

      const history: BaseMessage[] = parsedWSMessage.history.map((msg) => {
        if (msg[0] === 'human') {
          return new HumanMessage({
            content: msg[1],
          });
        } else {
          return new AIMessage({
            content: msg[1],
          });
        }
      });
      historyContent = history;
    }

    const handler = searchHandlers['webSearch'];
    if (handler) {
      const emitter = await handler(
        message,
        historyContent,
        llm,
        embeddings,
        type,
      );
      return res.status(200).json({ data: emitter });
    }

    res.status(200).json({});
  } catch (err) {
    res.status(500).json({ message: 'An error has occurred.' });
    logger.error(err.message);
  }
});

export default router;
