import fs from 'fs';
import path from 'path';
import toml from '@iarna/toml';
import dotenv from 'dotenv';
dotenv.config();

const configFileName = 'config.toml';

interface Config {
  DB: {
    MONGO_URI: string;
  };
  GENERAL: {
    PORT: number;
    SIMILARITY_MEASURE: string;
  };
  API_KEYS: {
    CLAUDE: string;
    OPENAI: string;
    GROQ: string;
    ANTHROPIC: string;
  };
  API_ENDPOINTS: {
    SEARXNG: string;
    OLLAMA: string;
  };
  SLACK: {
    SLACK_ERROR_CHANEEL_ID: string;
    SLACK_BOT_KEY:string
  };
}

type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};

const loadConfig = () =>
  toml.parse(
    fs.readFileSync(path.join(__dirname, `../${configFileName}`), 'utf-8'),
  ) as any as Config;

export const getPort = () => loadConfig().GENERAL.PORT;

export const getSimilarityMeasure = () =>
  loadConfig().GENERAL.SIMILARITY_MEASURE;

export const getMongoDBURI = () => loadConfig().DB.MONGO_URI;

export const getOpenaiApiKey = () => loadConfig().API_KEYS.OPENAI;

export const getClaudeApiKey = () => loadConfig().API_KEYS.CLAUDE;

export const getGroqApiKey = () => loadConfig().API_KEYS.GROQ;

export const getAnthropicApiKey = () => loadConfig().API_KEYS.ANTHROPIC;

export const getSearxngApiEndpoint = () => loadConfig().API_ENDPOINTS.SEARXNG;

export const getOllamaApiEndpoint = () => loadConfig().API_ENDPOINTS.OLLAMA;

export const getSlackErrorChannel=()=>loadConfig().SLACK.SLACK_ERROR_CHANEEL_ID

export const getSlackBotKey=()=>loadConfig().SLACK.SLACK_BOT_KEY

export const updateConfig = (config: RecursivePartial<Config>) => {
  const currentConfig = loadConfig();

  for (const key in currentConfig) {
    if (!config[key]) config[key] = {};

    if (typeof currentConfig[key] === 'object' && currentConfig[key] !== null) {
      for (const nestedKey in currentConfig[key]) {
        if (
          !config[key][nestedKey] &&
          currentConfig[key][nestedKey] &&
          config[key][nestedKey] !== ''
        ) {
          config[key][nestedKey] = currentConfig[key][nestedKey];
        }
      }
    } else if (currentConfig[key] && config[key] !== '') {
      config[key] = currentConfig[key];
    }
  }

  fs.writeFileSync(
    path.join(__dirname, `../${configFileName}`),
    toml.stringify(config),
  );
};
