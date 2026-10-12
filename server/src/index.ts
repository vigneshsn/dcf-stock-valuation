import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import stockRouter from './routes/stock.js';

const app = express();
app.use(cors());

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/stock', stockRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
