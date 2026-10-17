import 'dotenv/config';
import { createDatabase } from './database/database.js';
import { createApp } from './app.js';

process.env.NODE_ENV ||= 'development';
const db = await createDatabase();
const app = createApp(db);
const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Payment demo API listening at http://localhost:${port}`));
