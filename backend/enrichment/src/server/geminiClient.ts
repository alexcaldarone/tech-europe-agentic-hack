/**
 * Shared GoogleGenAI Client instance configured for server-side execution.
 */
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
const config = parse(fs.readFileSync(path.join(REPO_ROOT, 'configs/default.yaml'), 'utf-8'));

export const GEMINI_MODEL: string = config.enrichment.model;

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    '[GeminiClient] WARNING: GEMINI_API_KEY environment variable is not defined. Ensure it is configured in your environment or Secrets.'
  );
}

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});
