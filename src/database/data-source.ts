import 'dotenv/config';
import { DataSource } from 'typeorm';
import { getDatabaseOptions } from '../config/database.js';

export default new DataSource({
  ...getDatabaseOptions({ url: process.env.DATABASE_URL as string }),
  migrations: ['dist/database/migrations/*.js'],
});
