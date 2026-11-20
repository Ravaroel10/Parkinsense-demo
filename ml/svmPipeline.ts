/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FEATURE_NAMES,
  trainSvmModelCore,
  classifyWithModel,
  extractBme680Features,
  type SensorSamplePoint,
  type TrainedSvmModel,
  type ClassificationOutput,
} from '../src/ml/svmCore.ts';

export {
  FEATURE_NAMES,
  extractBme680Features,
  type SensorSamplePoint,
  type TrainedSvmModel,
  type ClassificationOutput,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MODEL_PATH = path.join(ROOT_DIR, 'data', 'svm_model.json');

let cachedModel: TrainedSvmModel | null = null;

export function trainAndSaveSvmModel(): TrainedSvmModel {
  const model = trainSvmModelCore();
  const dataDir = path.dirname(MODEL_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2), 'utf-8');
  cachedModel = model;
  return model;
}

export function getTrainedSvmModel(): TrainedSvmModel {
  if (cachedModel) return cachedModel;
  if (fs.existsSync(MODEL_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf-8')) as TrainedSvmModel;
      if (
        raw &&
        Array.isArray(raw.supportVectors) &&
        Array.isArray(raw.scalerMean) &&
        raw.featureNames?.length === FEATURE_NAMES.length
      ) {
        cachedModel = raw;
        return raw;
      }
    } catch {
      // fall through and retrain
    }
  }
  return trainAndSaveSvmModel();
}

export function classifyReadings(readings: SensorSamplePoint[]): ClassificationOutput {
  const model = getTrainedSvmModel();
  return classifyWithModel(readings, model);
}
