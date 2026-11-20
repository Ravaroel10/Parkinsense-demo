/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyReadings,
  getTrainedSvmModel,
  type ClassificationOutput,
} from './ml/svmPipeline.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const CSV_PATH = path.join(DATA_DIR, 'data.csv');

const DEFAULT_COLUMNS = [
  'id',
  'timestamp',
  'participantId',
  'sampleId',
  'diagnosis',
  'duration',
  'samplesCount',
  'fileSize',
  'operator',
  'filename',
  'seriesData',
  'classification',
] as const;

interface SensorDataPoint {
  timestamp: string;
  elapsed: number;
  s1Gas: number;
  s1Temp: number;
  s1Hum: number;
  s1Pres: number;
  s2Gas: number;
  s2Temp: number;
  s2Hum: number;
  s2Pres: number;
  s3Gas: number;
  s3Temp: number;
  s3Hum: number;
  s3Pres: number;
  s4Gas: number;
  s4Temp: number;
  s4Hum: number;
  s4Pres: number;
}

interface DatasetRecord {
  id: string;
  timestamp: string;
  participantId: string;
  sampleId: string;
  diagnosis: 'Healthy' | 'Parkinson';
  duration: number;
  samplesCount: number;
  fileSize: string;
  operator: string;
  filename: string;
  seriesData: SensorDataPoint[];
  classification?: ClassificationOutput;
}

// ============================================================================
// CSV Persistence Helpers (mirrors data/data.csv structure from main.py)
// ============================================================================
function escapeCsvField(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        currentRow.push(currentField);
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function generateSensorFrame(
  elapsedSec: number,
  diagnosis: 'Healthy' | 'Parkinson' = 'Parkinson'
): Omit<SensorDataPoint, 'timestamp' | 'elapsed'> {
  const isPd = diagnosis === 'Parkinson';
  const baseS1 = 320;
  const baseS2 = 340;
  const baseS3 = 310;
  const baseS4 = 330;

  const dropScale = isPd ? 0.58 : 0.42;
  const dropSpeed = isPd ? 0.04 : 0.025;

  const dropS1 = baseS1 * dropScale * (1 - Math.exp(-dropSpeed * elapsedSec));
  const dropS2 = baseS2 * (dropScale * 0.95) * (1 - Math.exp(-dropSpeed * 1.1 * elapsedSec));
  const dropS3 = baseS3 * (dropScale * 1.05) * (1 - Math.exp(-dropSpeed * 0.9 * elapsedSec));
  const dropS4 = baseS4 * (dropScale * 0.98) * (1 - Math.exp(-dropSpeed * 1.05 * elapsedSec));

  const noise = (Math.sin(elapsedSec * 0.5) + Math.cos(elapsedSec * 1.1)) * 0.4 + (Math.random() - 0.5) * 0.6;

  const s1Gas = Math.max(40, Math.round((baseS1 - dropS1 + noise) * 100) / 100);
  const s2Gas = Math.max(40, Math.round((baseS2 - dropS2 + noise * 0.9) * 100) / 100);
  const s3Gas = Math.max(40, Math.round((baseS3 - dropS3 + noise * 1.1) * 100) / 100);
  const s4Gas = Math.max(40, Math.round((baseS4 - dropS4 + noise * 0.95) * 100) / 100);

  const baseTemp = 28.2 + Math.sin(elapsedSec * 0.01) * 0.1 + (Math.random() - 0.5) * 0.04;
  const humRise = 4.2 * (1 - Math.exp(-0.015 * elapsedSec));
  const baseHum = 42.5 + humRise + (Math.random() - 0.5) * 0.08;
  const basePres = 1014.2 + (Math.random() - 0.5) * 0.08;

  return {
    s1Gas,
    s1Temp: Math.round((baseTemp + 0.2) * 100) / 100,
    s1Hum: Math.round(baseHum * 100) / 100,
    s1Pres: Math.round(basePres * 100) / 100,
    s2Gas,
    s2Temp: Math.round((baseTemp - 0.1) * 100) / 100,
    s2Hum: Math.round((baseHum - 0.8) * 100) / 100,
    s2Pres: Math.round((basePres - 0.1) * 100) / 100,
    s3Gas,
    s3Temp: Math.round((baseTemp + 0.4) * 100) / 100,
    s3Hum: Math.round((baseHum + 1.1) * 100) / 100,
    s3Pres: Math.round((basePres + 0.1) * 100) / 100,
    s4Gas,
    s4Temp: Math.round((baseTemp + 0.1) * 100) / 100,
    s4Hum: Math.round((baseHum + 0.3) * 100) / 100,
    s4Pres: Math.round(basePres * 100) / 100,
  };
}

function buildSeedSeries(diagnosis: 'Healthy' | 'Parkinson'): SensorDataPoint[] {
  const points: SensorDataPoint[] = [];
  const baseTime = Date.now() - 300_000;
  for (let s = 1; s <= 300; s += 1) {
    const timeVal = new Date(baseTime + s * 1000);
    points.push({
      timestamp: timeVal.toTimeString().split(' ')[0],
      elapsed: s,
      ...generateSensorFrame(s, diagnosis),
    });
  }
  return points;
}

function ensureCsvExists(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CSV_PATH) || fs.statSync(CSV_PATH).size === 0) {
    const seedRecords: DatasetRecord[] = [
      {
        id: 'REC-104821',
        filename: 'VOC_PARKINSON_SUBJ-PD-104_SEB-204.csv',
        timestamp: '2026-07-21 10:14:22',
        participantId: 'SUBJ-PD-104',
        sampleId: 'SEB-204',
        diagnosis: 'Parkinson',
        duration: 300,
        samplesCount: 300,
        fileSize: '44.2 KB',
        operator: 'Dr. R. Pratama',
        seriesData: buildSeedSeries('Parkinson'),
      },
      {
        id: 'REC-104819',
        filename: 'VOC_HEALTHY_SUBJ-HC-201_SEB-198.csv',
        timestamp: '2026-07-21 09:42:10',
        participantId: 'SUBJ-HC-201',
        sampleId: 'SEB-198',
        diagnosis: 'Healthy',
        duration: 300,
        samplesCount: 300,
        fileSize: '43.8 KB',
        operator: 'Dr. R. Pratama',
        seriesData: buildSeedSeries('Healthy'),
      },
    ];
    writeDatasets(seedRecords);
  }
}

function readDatasets(): DatasetRecord[] {
  ensureCsvExists();
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsvRows(raw);
  if (rows.length <= 1) return [];

  const headers = rows[0];
  const records: DatasetRecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const obj: Record<string, string> = {};
    headers.forEach((col, idx) => {
      obj[col] = values[idx] ?? '';
    });

    let parsedSeries: SensorDataPoint[] = [];
    if (obj.seriesData) {
      try {
        parsedSeries = JSON.parse(obj.seriesData);
      } catch {
        parsedSeries = [];
      }
    }

    let parsedClassification: ClassificationOutput | undefined;
    if (obj.classification) {
      try {
        parsedClassification = JSON.parse(obj.classification);
      } catch {
        parsedClassification = undefined;
      }
    }

    records.push({
      id: obj.id || `REC-${i}`,
      timestamp: obj.timestamp || '',
      participantId: obj.participantId || '',
      sampleId: obj.sampleId || '',
      diagnosis: obj.diagnosis === 'Healthy' ? 'Healthy' : 'Parkinson',
      duration: Number(obj.duration) || 300,
      samplesCount: Number(obj.samplesCount) || 300,
      fileSize: obj.fileSize || '0 KB',
      operator: obj.operator || 'Operator',
      filename: obj.filename || 'session.csv',
      seriesData: Array.isArray(parsedSeries) ? parsedSeries : [],
      classification: parsedClassification,
    });
  }

  return records;
}

function writeDatasets(records: DatasetRecord[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const headerLine = DEFAULT_COLUMNS.join(',');
  const dataLines = records.map((rec) => {
    const rowValues = DEFAULT_COLUMNS.map((col) => {
      if (col === 'seriesData') {
        return escapeCsvField(JSON.stringify(rec.seriesData || []));
      }
      if (col === 'classification') {
        return escapeCsvField(rec.classification ? JSON.stringify(rec.classification) : '');
      }
      return escapeCsvField(rec[col]);
    });
    return rowValues.join(',');
  });
  fs.writeFileSync(CSV_PATH, [headerLine, ...dataLines].join('\n') + '\n', 'utf-8');
}

// ============================================================================
// Serial & Live Telemetry State (Mirrors ESP32 + PCA9548A Bridge)
// ============================================================================
const serialState: {
  connected: boolean;
  port: string | null;
  baudRate: number;
  firmware: string;
  chip: string;
  multiplexer: string;
  pushedFrame: Partial<SensorDataPoint> | null;
  lastPushAt: number;
} = {
  connected: false,
  port: null,
  baudRate: 115200,
  firmware: 'v2.4.1',
  chip: 'ESP32-WROOM-32E',
  multiplexer: 'PCA9548A (0x70)',
  pushedFrame: null,
  lastPushAt: 0,
};

const AVAILABLE_PORTS = [
  { port: 'COM3', description: 'ESP32-WROOM-32E USB-UART Bridge (CP210x)' },
  { port: 'COM1', description: 'Standard Serial Port' },
  { port: 'COM4', description: 'CH340 USB-Serial Converter' },
  { port: '/dev/ttyUSB0', description: 'Linux UART Serial Device' },
  { port: 'VirtualPort', description: 'ParkinSense Virtual Lab Chamber' },
];

// ============================================================================
// Express App & API Routes
// ============================================================================
async function startServer() {
  ensureCsvExists();
  const svmModel = getTrainedSvmModel();
  console.log(
    `Loaded calibrated ${svmModel.algorithm} (${svmModel.supportVectors.length} support vectors, ${svmModel.cvAccuracy}% 5-fold CV)`
  );

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'ParkinSense Backend API',
      port: PORT,
      esp32Connected: serialState.connected,
      activePort: serialState.port,
      storage: 'data/data.csv',
    });
  });

  // Serial Port Discovery & Hardware Link
  app.get('/api/serial/status', (_req, res) => {
    res.json({
      connected: serialState.connected,
      port: serialState.port,
      baudRate: serialState.baudRate,
      firmware: serialState.firmware,
      chip: serialState.chip,
      multiplexer: serialState.multiplexer,
      availablePorts: AVAILABLE_PORTS,
    });
  });

  app.post('/api/serial/connect', (req, res) => {
    const requestedPort = String(req.body?.port || 'COM3');
    const baudRate = Number(req.body?.baudRate) || 115200;
    serialState.connected = true;
    serialState.port = requestedPort;
    serialState.baudRate = baudRate;

    res.json({
      status: 'connected',
      port: serialState.port,
      baudRate: serialState.baudRate,
      chip: serialState.chip,
      firmware: serialState.firmware,
      multiplexer: serialState.multiplexer,
      message: `Connected to ${serialState.chip} on ${serialState.port} at ${serialState.baudRate} baud`,
    });
  });

  app.post('/api/serial/disconnect', (_req, res) => {
    serialState.connected = false;
    serialState.port = null;
    serialState.pushedFrame = null;
    res.json({ status: 'disconnected', message: 'ESP32 serial connection closed' });
  });

  // Datasets CRUD (persisted to data/data.csv)
  app.get('/api/datasets', (_req, res) => {
    res.json(readDatasets());
  });

  app.post('/api/datasets', (req, res) => {
    const body = req.body;
    if (!body || !body.participantId || !body.sampleId || !body.filename) {
      res.status(400).json({ detail: 'participantId, sampleId, and filename are required' });
      return;
    }

    const records = readDatasets();
    const newRecord: DatasetRecord = {
      id: body.id || `REC-${Date.now().toString().slice(-6)}`,
      filename: String(body.filename),
      timestamp: String(body.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19)),
      participantId: String(body.participantId),
      sampleId: String(body.sampleId),
      diagnosis: body.diagnosis === 'Healthy' ? 'Healthy' : 'Parkinson',
      duration: Number(body.duration) || 300,
      samplesCount: Number(body.samplesCount) || (Array.isArray(body.seriesData) ? body.seriesData.length : 0),
      fileSize: String(body.fileSize || '0 KB'),
      operator: String(body.operator || 'Operator'),
      seriesData: Array.isArray(body.seriesData) ? body.seriesData : [],
      classification: body.classification || undefined,
    };

    records.unshift(newRecord);
    writeDatasets(records);
    res.status(201).json(newRecord);
  });

  // SVM Model Info & Actual Inference Endpoint
  app.get('/api/model/info', (_req, res) => {
    const m = getTrainedSvmModel();
    res.json({
      algorithm: m.algorithm,
      kernel: m.kernel,
      calibrationMethod: m.calibrationMethod,
      C: m.C,
      gamma: m.gamma,
      featureNames: m.featureNames,
      classMapping: m.classMapping,
      supportVectorCount: m.supportVectors.length,
      cvAccuracy: m.cvAccuracy,
      trainingSamples: m.trainingSamples,
      trainedAt: m.trainedAt,
    });
  });

  app.post('/api/classify', (req, res) => {
    try {
      const readings = req.body?.readings;
      if (!Array.isArray(readings) || readings.length < 2) {
        res.status(400).json({
          detail: 'Valid array of BME680 readings (minimum 2 frames) is required for SVM classification.',
        });
        return;
      }
      const result = classifyReadings(readings);
      res.json(result);
    } catch (err: any) {
      res.status(422).json({ detail: err?.message || 'Classification preprocessing error' });
    }
  });

  app.delete('/api/datasets/:id', (req, res) => {
    const targetId = req.params.id;
    const records = readDatasets();
    const remaining = records.filter((r) => String(r.id) !== targetId);

    if (remaining.length === records.length) {
      res.status(404).json({ detail: 'Dataset not found' });
      return;
    }

    writeDatasets(remaining);
    res.json({ message: 'Dataset deleted', id: targetId });
  });

  // Live Sensor Telemetry (GET for frontend polling, POST for hardware bridge ingestion)
  app.get('/api/live-data', (req, res) => {
    if (!serialState.connected) {
      res.json({ status: 'ESP32 not connected' });
      return;
    }

    // If an external hardware script pushed a frame in the last 3 seconds, return it
    if (serialState.pushedFrame && Date.now() - serialState.lastPushAt < 3000) {
      res.json({
        status: 'hardware-live',
        port: serialState.port,
        ...serialState.pushedFrame,
      });
      return;
    }

    const elapsed = Math.max(0, Number(req.query.elapsed) || 1);
    const diagnosis = req.query.diagnosis === 'Healthy' ? 'Healthy' : 'Parkinson';
    const nowStr = new Date().toTimeString().split(' ')[0];

    res.json({
      status: 'streaming',
      port: serialState.port,
      timestamp: nowStr,
      elapsed,
      ...generateSensorFrame(elapsed, diagnosis),
    });
  });

  app.post('/api/live-data', (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ detail: 'Invalid sensor frame payload' });
      return;
    }
    serialState.connected = true;
    serialState.port = serialState.port || 'HARDWARE-BRIDGE';
    serialState.pushedFrame = req.body;
    serialState.lastPushAt = Date.now();
    res.json({ status: 'ingested', timestamp: new Date().toISOString() });
  });

  // Ensure unmatched /api/* routes and JSON parse errors always return JSON (never HTML)
  app.use('/api', (_req, res) => {
    res.status(404).json({ detail: 'API endpoint not found' });
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      res.status(err?.status || 500).json({ detail: err?.message || 'Internal API error' });
      return;
    }
    next(err);
  });

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ParkinSense Full-Stack Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
