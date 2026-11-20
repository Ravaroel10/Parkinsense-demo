/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ParticipantInfo {
  participantId: string;
  sampleId: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  diagnosis: 'Healthy' | 'Parkinson';
  operatorName: string;
  institution: string;
  collectionDate: string;
  notes: string;
}

export interface SensorReading {
  temperature: number; // °C
  humidity: number; // %RH
  pressure: number; // hPa
  gasResistance: number; // kOhm
  status: 'Online' | 'Offline';
}

export interface LiveDataPoint {
  timestamp: string; // HH:mm:ss
  elapsed: number; // seconds
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

export interface ClassificationChannelSummary {
  channel: string;
  baselineKOhm: number;
  minKOhm: number;
  deltaRatioPct: number;
  aucDropPct: number;
}

export interface ClassificationResult {
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
  channelSummary: ClassificationChannelSummary[];
}

export interface DatasetItem {
  id: string;
  filename: string;
  timestamp: string;
  participantId: string;
  sampleId: string;
  diagnosis: 'Healthy' | 'Parkinson';
  duration: number; // in seconds
  samplesCount: number;
  fileSize: string; // e.g. "142 KB"
  operator: string;
  seriesData?: LiveDataPoint[];
  classification?: ClassificationResult;
}

export type ViewType = 'Dashboard' | 'Acquisition' | 'Datasets' | 'About';

export interface SystemSettings {
  theme: 'light' | 'dark';
  language: 'en' | 'de' | 'es' | 'fr';
  recordingInterval: number; // ms, default 1000
  samplingRate: number; // Hz, default 1
  autoConnect: boolean;
  autoDownload: boolean;
  csvDelimiter: ',' | ';';
  timeFormat: '12h' | '24h';
}
