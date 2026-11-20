/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DatasetItem, LiveDataPoint } from '../types';

// Helper to generate a realistic timestamps for July 2026
export const mockDatasets: DatasetItem[] = [
  {
    id: 'REC-2026-0720-001',
    filename: 'VOC_PARK_P1089_S332.csv',
    timestamp: '2026-07-20 14:32:05',
    participantId: 'PARK-1089',
    sampleId: 'SEB-332',
    diagnosis: 'Parkinson',
    duration: 300,
    samplesCount: 300,
    fileSize: '184 KB',
    operator: 'Clinical Operator',
  },
  {
    id: 'REC-2026-0720-002',
    filename: 'VOC_CTRL_H2094_S333.csv',
    timestamp: '2026-07-20 16:15:40',
    participantId: 'CTRL-2094',
    sampleId: 'SEB-333',
    diagnosis: 'Healthy',
    duration: 300,
    samplesCount: 300,
    fileSize: '183 KB',
    operator: 'Clinical Operator',
  },
  {
    id: 'REC-2026-0719-001',
    filename: 'VOC_PARK_P1076_S330.csv',
    timestamp: '2026-07-19 10:05:12',
    participantId: 'PARK-1076',
    sampleId: 'SEB-330',
    diagnosis: 'Parkinson',
    duration: 300,
    samplesCount: 300,
    fileSize: '185 KB',
    operator: 'Marcus Vance, MSc',
  },
  {
    id: 'REC-2026-0718-003',
    filename: 'VOC_CTRL_H2081_S329.csv',
    timestamp: '2026-07-18 15:45:22',
    participantId: 'CTRL-2081',
    sampleId: 'SEB-329',
    diagnosis: 'Healthy',
    duration: 300,
    samplesCount: 300,
    fileSize: '182 KB',
    operator: 'Clinical Operator',
  },
  {
    id: 'REC-2026-0718-002',
    filename: 'VOC_CTRL_H2072_S328.csv',
    timestamp: '2026-07-18 11:20:00',
    participantId: 'CTRL-2072',
    sampleId: 'SEB-328',
    diagnosis: 'Healthy',
    duration: 300,
    samplesCount: 300,
    fileSize: '184 KB',
    operator: 'Marcus Vance, MSc',
  },
  {
    id: 'REC-2026-0718-001',
    filename: 'VOC_PARK_P1061_S327.csv',
    timestamp: '2026-07-18 09:15:30',
    participantId: 'PARK-1061',
    sampleId: 'SEB-327',
    diagnosis: 'Parkinson',
    duration: 300,
    samplesCount: 300,
    fileSize: '186 KB',
    operator: 'Clinical Operator',
  }
];

/**
 * Simulates a realistic BME680 gas sensor curve for sebum headspace measurement.
 * Under exposure to skin sebum VOCs, metal-oxide semiconductor gas sensors (BME680)
 * experience changes in conductivity (gas resistance). Reducing VOCs like aldehydes
 * and alkanes (elevated in Parkinson's sebum) cause the resistance to drop.
 * 
 * @param second The elapsed time in seconds (0 to 300)
 * @param sensorIndex Sensor multiplexer channel 0-3
 * @param condition Whether the sample is 'Parkinson' or 'Healthy'
 */
export function generateSensorDataPoint(second: number, condition: 'Healthy' | 'Parkinson'): {
  s1Gas: number; s2Gas: number; s3Gas: number; s4Gas: number;
  s1Temp: number; s2Temp: number; s3Temp: number; s4Temp: number;
  s1Hum: number; s2Hum: number; s3Hum: number; s4Hum: number;
  s1Pres: number; s2Pres: number; s3Pres: number; s4Pres: number;
} {
  // Base baseline gas resistances in kOhms (sensors vary slightly)
  const baseS1 = 320;
  const baseS2 = 340;
  const baseS3 = 310;
  const baseS4 = 330;

  // Parkinson's sebum typically has elevated levels of highly volatile aldehydes (e.g. octanal, hexanal)
  // and specific lipids (e.g. eicosane) which act as reducing VOCs, causing a steeper and deeper drop in metal oxide resistance.
  const dropScale = condition === 'Parkinson' ? 0.58 : 0.42; // steeper and deeper drop for Parkinson
  const dropSpeed = condition === 'Parkinson' ? 0.04 : 0.025; // faster response

  // Exponential drop and gradual level-off
  const dropS1 = baseS1 * dropScale * (1 - Math.exp(-dropSpeed * second));
  const dropS2 = baseS2 * (dropScale * 0.95) * (1 - Math.exp(-dropSpeed * 1.1 * second));
  const dropS3 = baseS3 * (dropScale * 1.05) * (1 - Math.exp(-dropSpeed * 0.9 * second));
  const dropS4 = baseS4 * (dropScale * 0.98) * (1 - Math.exp(-dropSpeed * 1.05 * second));

  // Add micro-noise (+- 0.5 kOhm) for realism
  const noise = (Math.sin(second * 0.5) + Math.cos(second * 1.1)) * 0.4;

  // Temperature (ambient, self-heating keeps sensors stable)
  const t1 = 28.4 + Math.sin(second * 0.01) * 0.1 + (Math.random() - 0.5) * 0.02;
  const t2 = 28.1 + Math.cos(second * 0.01) * 0.1 + (Math.random() - 0.5) * 0.02;
  const t3 = 28.6 + Math.sin(second * 0.01 + 1) * 0.1 + (Math.random() - 0.5) * 0.02;
  const t4 = 28.3 + Math.cos(second * 0.01 - 1) * 0.1 + (Math.random() - 0.5) * 0.02;

  // Humidity (slightly rises inside the acrylic chamber as sebum sample is inserted)
  const baseHum = 42.5;
  const humRise = 4.2 * (1 - Math.exp(-0.015 * second));
  const h1 = baseHum + humRise + (Math.random() - 0.5) * 0.05;
  const h2 = baseHum - 0.8 + humRise * 1.02 + (Math.random() - 0.5) * 0.05;
  const h3 = baseHum + 1.1 + humRise * 0.97 + (Math.random() - 0.5) * 0.05;
  const h4 = baseHum + 0.3 + humRise * 1.01 + (Math.random() - 0.5) * 0.05;

  // Pressure (barometric, extremely stable at ~1013.25 hPa)
  const p1 = 1014.2 + (Math.random() - 0.5) * 0.05;
  const p2 = 1014.1 + (Math.random() - 0.5) * 0.05;
  const p3 = 1014.3 + (Math.random() - 0.5) * 0.05;
  const p4 = 1014.2 + (Math.random() - 0.5) * 0.05;

  return {
    s1Gas: parseFloat((baseS1 - dropS1 + noise).toFixed(2)),
    s2Gas: parseFloat((baseS2 - dropS2 + noise * 0.9).toFixed(2)),
    s3Gas: parseFloat((baseS3 - dropS3 + noise * 1.1).toFixed(2)),
    s4Gas: parseFloat((baseS4 - dropS4 + noise * 0.95).toFixed(2)),

    s1Temp: parseFloat(t1.toFixed(2)),
    s2Temp: parseFloat(t2.toFixed(2)),
    s3Temp: parseFloat(t3.toFixed(2)),
    s4Temp: parseFloat(t4.toFixed(2)),

    s1Hum: parseFloat(h1.toFixed(2)),
    s2Hum: parseFloat(h2.toFixed(2)),
    s3Hum: parseFloat(h3.toFixed(2)),
    s4Hum: parseFloat(h4.toFixed(2)),

    s1Pres: parseFloat(p1.toFixed(2)),
    s2Pres: parseFloat(p2.toFixed(2)),
    s3Pres: parseFloat(p3.toFixed(2)),
    s4Pres: parseFloat(p4.toFixed(2)),
  };
}

/**
 * Generates a complete history series of 300 data points for a specific session to render in details.
 */
export function generateSessionSeries(condition: 'Healthy' | 'Parkinson'): LiveDataPoint[] {
  const points: LiveDataPoint[] = [];
  for (let i = 0; i <= 300; i += 5) {
    const timeVal = new Date(Date.now() - (300 - i) * 1000);
    const timestamp = timeVal.toTimeString().split(' ')[0];
    const data = generateSensorDataPoint(i, condition);
    points.push({
      timestamp,
      elapsed: i,
      ...data
    });
  }
  return points;
}
