/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SensorSamplePoint {
  timestamp: string;
  elapsed: number;
  s1Gas: number;
  s2Gas: number;
  s3Gas: number;
  s4Gas: number;
  s1Temp?: number;
  s2Temp?: number;
  s3Temp?: number;
  s4Temp?: number;
  s1Hum?: number;
  s2Hum?: number;
  s3Hum?: number;
  s4Hum?: number;
  s1Pres?: number;
  s2Pres?: number;
  s3Pres?: number;
  s4Pres?: number;
}

export const FEATURE_NAMES = [
  's1_delta_ratio',
  's1_mean_norm',
  's1_auc_drop',
  's1_initial_slope',
  's2_delta_ratio',
  's2_mean_norm',
  's2_auc_drop',
  's2_initial_slope',
  's3_delta_ratio',
  's3_mean_norm',
  's3_auc_drop',
  's3_initial_slope',
  's4_delta_ratio',
  's4_mean_norm',
  's4_auc_drop',
  's4_initial_slope',
] as const;

export interface TrainedSvmModel {
  algorithm: string;
  kernel: 'rbf';
  calibrationMethod: string;
  C: number;
  gamma: number;
  featureNames: string[];
  classMapping: {
    positive: 'Parkinson';
    negative: 'Non-Parkinson';
  };
  scalerMean: number[];
  scalerStd: number[];
  supportVectors: number[][];
  dualCoefs: number[];
  bias: number;
  plattA: number;
  plattB: number;
  cvAccuracy: number;
  trainingSamples: number;
  trainedAt: string;
}

export interface ClassificationOutput {
  predictedClass: 'Parkinson' | 'Non-Parkinson';
  parkinsonProbability: number;
  nonParkinsonProbability: number;
  modelConfidence: number;
  confidenceLevel: 'High' | 'Moderate' | 'Borderline';
  decisionScore: number;
  calibrationMethod: string;
  algorithm: string;
  cvAccuracy: number;
  framesAnalyzed: number;
  testedAt: string;
  channelSummary: Array<{
    channel: string;
    baselineKOhm: number;
    minKOhm: number;
    deltaRatioPct: number;
    aucDropPct: number;
  }>;
}

function extractChannelFeatures(series: number[], times: number[]): {
  deltaRatio: number;
  meanNorm: number;
  aucDrop: number;
  initialSlope: number;
  baseline: number;
  minVal: number;
} {
  if (series.length === 0) {
    return {
      deltaRatio: 0,
      meanNorm: 1,
      aucDrop: 0,
      initialSlope: 0,
      baseline: 0,
      minVal: 0,
    };
  }

  const headCount = Math.min(3, series.length);
  let r0 = 0;
  for (let i = 0; i < headCount; i++) r0 += series[i];
  r0 = Math.max(r0 / headCount, 1e-6);

  let minVal = series[0];
  let sumNorm = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i] < minVal) minVal = series[i];
    sumNorm += series[i] / r0;
  }

  const meanNorm = sumNorm / series.length;
  const deltaRatio = (r0 - minVal) / r0;

  let auc = 0;
  if (series.length > 1) {
    let totalDt = 0;
    for (let i = 1; i < series.length; i++) {
      const dt = Math.max(times[i] - times[i - 1], 1);
      const yPrev = 1 - series[i - 1] / r0;
      const yCurr = 1 - series[i] / r0;
      auc += 0.5 * (yPrev + yCurr) * dt;
      totalDt += dt;
    }
    auc = totalDt > 0 ? auc / totalDt : 0;
  } else {
    auc = 1 - series[0] / r0;
  }

  const earlyIdx = Math.min(series.length - 1, Math.max(1, Math.floor(series.length * 0.25)));
  const dtEarly = Math.max(times[earlyIdx] - times[0], 1);
  const initialSlope = ((r0 - series[earlyIdx]) / r0) / dtEarly;

  return {
    deltaRatio,
    meanNorm,
    aucDrop: auc,
    initialSlope,
    baseline: r0,
    minVal,
  };
}

export function extractBme680Features(readings: SensorSamplePoint[]): {
  vector: number[];
  channelSummary: ClassificationOutput['channelSummary'];
} {
  const sorted = [...readings].sort((a, b) => a.elapsed - b.elapsed);
  const times = sorted.map((r, idx) => (typeof r.elapsed === 'number' ? r.elapsed : idx));

  const channels = [
    { name: 'CH1', series: sorted.map((r) => Number(r.s1Gas) || 0) },
    { name: 'CH2', series: sorted.map((r) => Number(r.s2Gas) || 0) },
    { name: 'CH3', series: sorted.map((r) => Number(r.s3Gas) || 0) },
    { name: 'CH4', series: sorted.map((r) => Number(r.s4Gas) || 0) },
  ];

  const vector: number[] = [];
  const channelSummary: ClassificationOutput['channelSummary'] = [];

  for (const ch of channels) {
    const f = extractChannelFeatures(ch.series, times);
    vector.push(f.deltaRatio, f.meanNorm, f.aucDrop, f.initialSlope);
    channelSummary.push({
      channel: ch.name,
      baselineKOhm: Math.round(f.baseline * 10) / 10,
      minKOhm: Math.round(f.minVal * 10) / 10,
      deltaRatioPct: Math.round(f.deltaRatio * 1000) / 10,
      aucDropPct: Math.round(f.aucDrop * 1000) / 10,
    });
  }

  return { vector, channelSummary };
}

function fitStandardScaler(X: number[][]): { mean: number[]; std: number[] } {
  const n = X.length;
  const d = X[0].length;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) mean[j] += X[i][j];
  }
  for (let j = 0; j < d; j++) mean[j] /= n;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      const diff = X[i][j] - mean[j];
      std[j] += diff * diff;
    }
  }
  for (let j = 0; j < d; j++) {
    std[j] = Math.sqrt(std[j] / n);
    if (std[j] < 1e-8) std[j] = 1;
  }
  return { mean, std };
}

function applyStandardScaler(X: number[][], mean: number[], std: number[]): number[][] {
  return X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));
}

function rbfKernel(a: number[], b: number[], gamma: number): number {
  let sq = 0;
  for (let j = 0; j < a.length; j++) {
    const d = a[j] - b[j];
    sq += d * d;
  }
  return Math.exp(-gamma * sq);
}

interface SvmFitResult {
  supportVectors: number[][];
  dualCoefs: number[];
  bias: number;
  gamma: number;
}

function fitRbfSvmSmo(X: number[][], y: number[], C = 2.0, gamma?: number): SvmFitResult {
  const n = X.length;
  const d = X[0].length;
  const g = gamma ?? 1 / d;

  const K: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const val = rbfKernel(X[i], X[j], g);
      K[i][j] = val;
      K[j][i] = val;
    }
  }

  const alpha = new Array<number>(n).fill(0);
  let b = 0;
  const tol = 1e-4;
  const maxPasses = 40;
  let passes = 0;

  const evalIndex = (idx: number) => {
    let sum = b;
    for (let k = 0; k < n; k++) {
      if (alpha[k] > 0) sum += alpha[k] * y[k] * K[k][idx];
    }
    return sum;
  };

  while (passes < maxPasses) {
    let numChanged = 0;
    for (let i = 0; i < n; i++) {
      const Ei = evalIndex(i) - y[i];
      if ((y[i] * Ei < -tol && alpha[i] < C) || (y[i] * Ei > tol && alpha[i] > 0)) {
        let j = -1;
        let maxDiff = -1;
        for (let cand = 0; cand < n; cand++) {
          if (cand === i) continue;
          const Ecand = evalIndex(cand) - y[cand];
          const diff = Math.abs(Ei - Ecand);
          if (diff > maxDiff) {
            maxDiff = diff;
            j = cand;
          }
        }
        if (j < 0) continue;

        const Ej = evalIndex(j) - y[j];
        const alphaIOld = alpha[i];
        const alphaJOld = alpha[j];

        let L: number;
        let H: number;
        if (y[i] !== y[j]) {
          L = Math.max(0, alpha[j] - alpha[i]);
          H = Math.min(C, C + alpha[j] - alpha[i]);
        } else {
          L = Math.max(0, alpha[i] + alpha[j] - C);
          H = Math.min(C, alpha[i] + alpha[j]);
        }
        if (Math.abs(L - H) < 1e-9) continue;

        const eta = 2 * K[i][j] - K[i][i] - K[j][j];
        if (eta >= 0) continue;

        alpha[j] = alphaJOld - (y[j] * (Ei - Ej)) / eta;
        if (alpha[j] > H) alpha[j] = H;
        else if (alpha[j] < L) alpha[j] = L;

        if (Math.abs(alpha[j] - alphaJOld) < 1e-6) continue;

        alpha[i] = alphaIOld + y[i] * y[j] * (alphaJOld - alpha[j]);

        const b1 =
          b -
          Ei -
          y[i] * (alpha[i] - alphaIOld) * K[i][i] -
          y[j] * (alpha[j] - alphaJOld) * K[i][j];
        const b2 =
          b -
          Ej -
          y[i] * (alpha[i] - alphaIOld) * K[i][j] -
          y[j] * (alpha[j] - alphaJOld) * K[j][j];

        if (alpha[i] > 0 && alpha[i] < C) b = b1;
        else if (alpha[j] > 0 && alpha[j] < C) b = b2;
        else b = 0.5 * (b1 + b2);

        numChanged++;
      }
    }
    passes = numChanged === 0 ? passes + 1 : 0;
  }

  const supportVectors: number[][] = [];
  const dualCoefs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (alpha[i] > 1e-7) {
      supportVectors.push(X[i]);
      dualCoefs.push(alpha[i] * y[i]);
    }
  }

  return { supportVectors, dualCoefs, bias: b, gamma: g };
}

function decisionFunction(
  xScaled: number[],
  model: Pick<SvmFitResult, 'supportVectors' | 'dualCoefs' | 'bias' | 'gamma'>
): number {
  let sum = model.bias;
  for (let i = 0; i < model.supportVectors.length; i++) {
    sum += model.dualCoefs[i] * rbfKernel(model.supportVectors[i], xScaled, model.gamma);
  }
  return sum;
}

function fitPlattCalibration(deci: number[], labels: number[]): { A: number; B: number } {
  let prior1 = 0;
  let prior0 = 0;
  for (const y of labels) {
    if (y > 0) prior1++;
    else prior0++;
  }

  const hiTarget = (prior1 + 1.0) / (prior1 + 2.0);
  const loTarget = 1.0 / (prior0 + 2.0);
  const t = labels.map((y) => (y > 0 ? hiTarget : loTarget));

  let A = 0.0;
  let B = Math.log((prior0 + 1.0) / (prior1 + 1.0));
  const maxIter = 100;
  const minStep = 1e-10;
  const sigma = 1e-12;

  let fval = 0.0;
  for (let i = 0; i < deci.length; i++) {
    const fApB = deci[i] * A + B;
    if (fApB >= 0) fval += t[i] * fApB + Math.log(1 + Math.exp(-fApB));
    else fval += (t[i] - 1) * fApB + Math.log(1 + Math.exp(fApB));
  }

  for (let it = 0; it < maxIter; it++) {
    let h11 = sigma;
    let h22 = sigma;
    let h21 = 0.0;
    let g1 = 0.0;
    let g2 = 0.0;

    for (let i = 0; i < deci.length; i++) {
      const fApB = deci[i] * A + B;
      const p =
        fApB >= 0
          ? Math.exp(-fApB) / (1.0 + Math.exp(-fApB))
          : 1.0 / (1.0 + Math.exp(fApB));
      const q = 1.0 - p;
      const d2 = p * q;
      h11 += deci[i] * deci[i] * d2;
      h22 += d2;
      h21 += deci[i] * d2;
      const d1 = t[i] - p;
      g1 += deci[i] * d1;
      g2 += d1;
    }

    if (Math.abs(g1) < 1e-5 && Math.abs(g2) < 1e-5) break;

    const det = h11 * h22 - h21 * h21;
    const dA = -(h22 * g1 - h21 * g2) / det;
    const dB = -(-h21 * g1 + h11 * g2) / det;
    const gd = g1 * dA + g2 * dB;

    let stepsize = 1.0;
    while (stepsize >= minStep) {
      const newA = A + stepsize * dA;
      const newB = B + stepsize * dB;
      let newf = 0.0;
      for (let i = 0; i < deci.length; i++) {
        const fApB = deci[i] * newA + newB;
        if (fApB >= 0) newf += t[i] * fApB + Math.log(1 + Math.exp(-fApB));
        else newf += (t[i] - 1) * fApB + Math.log(1 + Math.exp(fApB));
      }
      if (newf < fval + 0.0001 * stepsize * gd) {
        A = newA;
        B = newB;
        fval = newf;
        break;
      }
      stepsize /= 2.0;
    }
    if (stepsize < minStep) break;
  }

  return { A, B };
}

function plattPredictProb(f: number, A: number, B: number): number {
  const fApB = f * A + B;
  if (fApB >= 0) {
    const expVal = Math.exp(-fApB);
    return expVal / (1.0 + expVal);
  }
  return 1.0 / (1.0 + Math.exp(fApB));
}

function createDeterministicRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function generateTrainingCohort(): { X: number[][]; y: number[] } {
  const rng = createDeterministicRng(20260721);
  const gauss = () => {
    const u1 = Math.max(rng(), 1e-7);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const X: number[][] = [];
  const y: number[] = [];
  const totalSamples = 64;

  for (let idx = 0; idx < totalSamples; idx++) {
    const isPd = idx % 2 === 0;
    const baseOffsets = [
      320 + gauss() * 14,
      340 + gauss() * 14,
      310 + gauss() * 14,
      330 + gauss() * 14,
    ];
    const dropScale = (isPd ? 0.57 : 0.42) + gauss() * 0.045;
    const dropSpeed = (isPd ? 0.039 : 0.025) + gauss() * 0.004;

    const useOneHz = idx % 4 < 2;
    const step = useOneHz ? 1 : 5;
    const startSec = useOneHz ? 1 : 0;

    const readings: SensorSamplePoint[] = [];
    for (let sec = startSec; sec <= 300; sec += step) {
      const noise = gauss() * 0.45;
      const d1 = baseOffsets[0] * dropScale * (1 - Math.exp(-dropSpeed * sec));
      const d2 = baseOffsets[1] * (dropScale * 0.95) * (1 - Math.exp(-dropSpeed * 1.1 * sec));
      const d3 = baseOffsets[2] * (dropScale * 1.05) * (1 - Math.exp(-dropSpeed * 0.9 * sec));
      const d4 = baseOffsets[3] * (dropScale * 0.98) * (1 - Math.exp(-dropSpeed * 1.05 * sec));

      readings.push({
        timestamp: `00:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`,
        elapsed: sec,
        s1Gas: Math.max(30, baseOffsets[0] - d1 + noise),
        s2Gas: Math.max(30, baseOffsets[1] - d2 + noise * 0.9),
        s3Gas: Math.max(30, baseOffsets[2] - d3 + noise * 1.1),
        s4Gas: Math.max(30, baseOffsets[3] - d4 + noise * 0.95),
      });
    }

    const { vector } = extractBme680Features(readings);
    X.push(vector);
    y.push(isPd ? 1 : -1);
  }

  return { X, y };
}

let cachedCoreModel: TrainedSvmModel | null = null;

export function trainSvmModelCore(): TrainedSvmModel {
  if (cachedCoreModel) return cachedCoreModel;

  const { X, y } = generateTrainingCohort();
  const n = X.length;
  const folds = 5;
  const C = 2.0;
  const gamma = 1 / FEATURE_NAMES.length;

  const oofDecisions = new Array<number>(n).fill(0);
  let correctCv = 0;

  for (let fold = 0; fold < folds; fold++) {
    const trainX: number[][] = [];
    const trainY: number[] = [];
    const valIndices: number[] = [];

    for (let i = 0; i < n; i++) {
      if (i % folds === fold) valIndices.push(i);
      else {
        trainX.push(X[i]);
        trainY.push(y[i]);
      }
    }

    const foldScaler = fitStandardScaler(trainX);
    const trainScaled = applyStandardScaler(trainX, foldScaler.mean, foldScaler.std);
    const foldSvm = fitRbfSvmSmo(trainScaled, trainY, C, gamma);

    const valX = valIndices.map((idx) => X[idx]);
    const valScaled = applyStandardScaler(valX, foldScaler.mean, foldScaler.std);

    for (let k = 0; k < valIndices.length; k++) {
      const idx = valIndices[k];
      const f = decisionFunction(valScaled[k], foldSvm);
      oofDecisions[idx] = f;
      const pred = f >= 0 ? 1 : -1;
      if (pred === y[idx]) correctCv++;
    }
  }

  const platt = fitPlattCalibration(oofDecisions, y);
  const finalScaler = fitStandardScaler(X);
  const XScaled = applyStandardScaler(X, finalScaler.mean, finalScaler.std);
  const finalSvm = fitRbfSvmSmo(XScaled, y, C, gamma);

  cachedCoreModel = {
    algorithm: 'Support Vector Machine (RBF Kernel)',
    kernel: 'rbf',
    calibrationMethod: '5-Fold Out-of-Fold Platt Scaling (Sigmoid Calibration)',
    C,
    gamma: finalSvm.gamma,
    featureNames: [...FEATURE_NAMES],
    classMapping: {
      positive: 'Parkinson',
      negative: 'Non-Parkinson',
    },
    scalerMean: finalScaler.mean,
    scalerStd: finalScaler.std,
    supportVectors: finalSvm.supportVectors,
    dualCoefs: finalSvm.dualCoefs,
    bias: finalSvm.bias,
    plattA: platt.A,
    plattB: platt.B,
    cvAccuracy: Math.round((correctCv / n) * 1000) / 10,
    trainingSamples: n,
    trainedAt: new Date().toISOString(),
  };

  return cachedCoreModel;
}

export function classifyWithModel(
  readings: SensorSamplePoint[],
  model: TrainedSvmModel
): ClassificationOutput {
  if (!Array.isArray(readings) || readings.length < 2) {
    throw new Error(
      'Minimal 2 frame pembacaan sensor BME680 diperlukan untuk preprocessing dan klasifikasi SVM.'
    );
  }

  const { vector, channelSummary } = extractBme680Features(readings);
  const scaledVector = vector.map((v, j) => (v - model.scalerMean[j]) / model.scalerStd[j]);
  const f = decisionFunction(scaledVector, model);

  const probParkinsonRaw = plattPredictProb(f, model.plattA, model.plattB);
  const parkinsonPct = Math.round(probParkinsonRaw * 1000) / 10;
  const nonParkinsonPct = Math.round((100 - parkinsonPct) * 10) / 10;

  const predictedClass: 'Parkinson' | 'Non-Parkinson' =
    probParkinsonRaw >= 0.5 ? 'Parkinson' : 'Non-Parkinson';

  const modelConfidence = Math.max(parkinsonPct, nonParkinsonPct);
  const confidenceLevel: 'High' | 'Moderate' | 'Borderline' =
    modelConfidence >= 80 ? 'High' : modelConfidence >= 65 ? 'Moderate' : 'Borderline';

  return {
    predictedClass,
    parkinsonProbability: parkinsonPct,
    nonParkinsonProbability: nonParkinsonPct,
    modelConfidence,
    confidenceLevel,
    decisionScore: Math.round(f * 10000) / 10000,
    calibrationMethod: model.calibrationMethod,
    algorithm: model.algorithm,
    cvAccuracy: model.cvAccuracy,
    framesAnalyzed: readings.length,
    testedAt: new Date().toISOString(),
    channelSummary,
  };
}

export function classifyReadingsClient(readings: SensorSamplePoint[]): ClassificationOutput {
  const model = trainSvmModelCore();
  return classifyWithModel(readings, model);
}
