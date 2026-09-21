import dotenv from 'dotenv';
import { createApp } from './app.js';

dotenv.config({ quiet: true });

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT debe ser un número entre 1 y 65535.');
}

createApp().listen(port, '0.0.0.0', () => {
  console.log(`OpenRouter Prompt Lab: http://localhost:${port}`);
});
