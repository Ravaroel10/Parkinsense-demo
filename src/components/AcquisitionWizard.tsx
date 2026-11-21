/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ParticipantInfo, LiveDataPoint, ClassificationResult } from '../types';
import Chamber3DView from './Chamber3DView';
import ClassificationResultPanel from './ClassificationResultPanel';
import { generateSensorDataPoint } from '../data/mockData';
import {
  connectSerialOnApi,
  disconnectSerialOnApi,
  fetchLiveSensorFromApi,
  classifyReadingsOnApi,
} from '../services/api';
import {
  Usb,
  User,
  Beaker,
  Compass,
  Play,
  Pause,
  Square,
  CheckCircle2,
  Clock,
  Download,
  FolderOpen,
  ArrowRight,
  FastForward,
  Info,
  Cpu,
  Radio,
  Check,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';

interface AcquisitionWizardProps {
  onSessionFinished: (
    participant: ParticipantInfo,
    readings: LiveDataPoint[],
    classification?: ClassificationResult
  ) => string | void;
  onOpenDataset?: (datasetId?: string) => void;
  isDeviceConnected: boolean;
  onSetDeviceConnected: (connected: boolean) => void;
  activeReadings: LiveDataPoint[];
  onSetActiveReadings: (updater: (prev: LiveDataPoint[]) => LiveDataPoint[]) => void;
}

const TOTAL_STABILIZATION_SEC = 90;
const TOTAL_RECORDING_SEC = 300;

export default function AcquisitionWizard({
  onSessionFinished,
  onOpenDataset,
  isDeviceConnected,
  onSetDeviceConnected,
  activeReadings,
  onSetActiveReadings,
}: AcquisitionWizardProps) {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [comPort, setComPort] = useState<string>('COM3');
  const [baudRate] = useState<number>(115200);
  const [espStatus, setEspStatus] = useState<'Disconnected' | 'Handshaking' | 'Online'>(
    isDeviceConnected ? 'Online' : 'Disconnected'
  );
  const [connectionLog, setConnectionLog] = useState<string[]>([
    'System Idle. Awaiting ESP32-WROOM-32E USB serial handshake...',
  ]);

  // Step 2: Participant Info Form
  const [participant, setParticipant] = useState<ParticipantInfo>({
    participantId: 'SUBJ-001',
    sampleId: 'SEB-001',
    age: 55,
    gender: 'Male',
    diagnosis: 'Parkinson',
    operatorName: 'Operator',
    institution: 'Medical Research Center',
    collectionDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Step 3: Sample Preparation Checklist
  const [prepChecklist, setPrepChecklist] = useState({
    chamberCleaned: false,
    sampleInserted: false,
    chamberSealed: false,
    filterActive: false,
  });

  // Step 4: Stabilization state
  const [stabilizationProgress, setStabilizationProgress] = useState(0);
  const [stabilizationSeconds, setStabilizationSeconds] = useState(TOTAL_STABILIZATION_SEC);

  // Step 5: Recording state
  const [recordingSeconds, setRecordingSeconds] = useState(TOTAL_RECORDING_SEC);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [focusedSensor, setFocusedSensor] = useState<number | null>(null);

  // Step 6: Saved dataset & SVM classification state
  const [savedDatasetId, setSavedDatasetId] = useState<string | undefined>(undefined);
  const [classificationResult, setClassificationResult] = useState<ClassificationResult | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);
  const sessionSavedRef = useRef(false);

  // Refs for clean timers and latest readings access
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const serialPortRef = useRef<any>(null);
  const readingsRef = useRef<LiveDataPoint[]>(activeReadings);

  useEffect(() => {
    readingsRef.current = activeReadings;
  }, [activeReadings]);

  useEffect(() => {
    setEspStatus(isDeviceConnected ? 'Online' : 'Disconnected');
  }, [isDeviceConnected]);

  const runClassification = async (readingsToClassify: LiveDataPoint[]): Promise<ClassificationResult | undefined> => {
    setIsClassifying(true);
    setClassificationError(null);
    try {
      const result = await classifyReadingsOnApi(readingsToClassify);
      setClassificationResult(result);
      return result;
    } catch (err: any) {
      setClassificationError(
        err?.message || 'Gagal menjalankan klasifikasi model SVM pada data sensor BME680.'
      );
      return undefined;
    } finally {
      setIsClassifying(false);
    }
  };

  const finalizeSession = async (finalReadings: LiveDataPoint[]) => {
    if (sessionSavedRef.current) return;
    sessionSavedRef.current = true;
    const result = await runClassification(finalReadings);
    const createdId = onSessionFinished(participant, finalReadings, result);
    if (typeof createdId === 'string') {
      setSavedDatasetId(createdId);
    }
  };

  // Web Serial or Backend COM Port hardware connection
  const initiateConnection = async () => {
    setEspStatus('Handshaking');
    setConnectionLog((prev) => [...prev, `Probing ${comPort} @ ${baudRate} baud...`]);

    if ('serial' in navigator) {
      try {
        setConnectionLog((prev) => [...prev, 'Requesting Web Serial API hardware port...']);
        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate });
        serialPortRef.current = port;
        await connectSerialOnApi(comPort, baudRate);
        setConnectionLog((prev) => [
          ...prev,
          `ESP32-WROOM-32E linked via Web Serial API (${baudRate} baud).`,
          'PCA9548A I2C Multiplexer Channels 0x70 [0-3] ACK OK.',
          '4× BME680 environmental & VOC sensors online.',
        ]);
        setEspStatus('Online');
        onSetDeviceConnected(true);
        return;
      } catch (err: any) {
        setConnectionLog((prev) => [
          ...prev,
          `Web Serial Notice: ${err.message || 'Port selection cancelled.'}`,
          `Connecting via backend serial bridge on ${comPort}...`,
        ]);
      }
    }

    const res = await connectSerialOnApi(comPort, baudRate);
    if (res) {
      setConnectionLog((prev) => [
        ...prev,
        res.message,
        `Firmware ${res.firmware} • ${res.multiplexer} initialized`,
        '4× BME680 channels online via /api/live-data.',
      ]);
      setEspStatus('Online');
      onSetDeviceConnected(true);
    } else {
      setConnectionLog((prev) => [
        ...prev,
        `Connected to local fallback bridge on ${comPort} (${baudRate} Baud)`,
      ]);
      setEspStatus('Online');
      onSetDeviceConnected(true);
    }
  };

  const disconnectDevice = async () => {
    if (serialPortRef.current) {
      try {
        await serialPortRef.current.close();
      } catch {
        // ignore close errors
      }
      serialPortRef.current = null;
    }
    await disconnectSerialOnApi();
    setEspStatus('Disconnected');
    onSetDeviceConnected(false);
    setConnectionLog(['ESP32 hardware disconnected. Serial interface idle.']);
  };

  // Step 4: Stabilization countdown effect
  useEffect(() => {
    if (currentStep !== 4) return;
    const interval = setInterval(() => {
      setStabilizationSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setStabilizationProgress(100);
          sessionSavedRef.current = false;
          setCurrentStep(5);
          setIsRecordingActive(true);
          return 0;
        }
        const next = prev - 1;
        setStabilizationProgress(
          Math.round(((TOTAL_STABILIZATION_SEC - next) / TOTAL_STABILIZATION_SEC) * 100)
        );
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [currentStep]);

  // Step 5: Live Recording effect (polls backend /api/live-data at 1Hz)
  const recordingSecRef = useRef(recordingSeconds);
  useEffect(() => {
    recordingSecRef.current = recordingSeconds;
  }, [recordingSeconds]);

  useEffect(() => {
    if (currentStep === 5 && isRecordingActive && recordingSeconds > 0) {
      timerRef.current = setInterval(async () => {
        const currentRem = recordingSecRef.current;
        if (currentRem <= 0) return;

        const nextSec = currentRem - 1;
        const elapsed = TOTAL_RECORDING_SEC - nextSec;
        recordingSecRef.current = nextSec;
        setRecordingSeconds(nextSec);

        const apiReading = await fetchLiveSensorFromApi(elapsed, participant.diagnosis);
        const fallback = generateSensorDataPoint(elapsed, participant.diagnosis);
        const nowStr = new Date().toTimeString().split(' ')[0];

        const newPoint: LiveDataPoint = {
          timestamp: apiReading?.timestamp || nowStr,
          elapsed,
          s1Gas: apiReading?.s1Gas ?? fallback.s1Gas,
          s1Temp: apiReading?.s1Temp ?? fallback.s1Temp,
          s1Hum: apiReading?.s1Hum ?? fallback.s1Hum,
          s1Pres: apiReading?.s1Pres ?? fallback.s1Pres,
          s2Gas: apiReading?.s2Gas ?? fallback.s2Gas,
          s2Temp: apiReading?.s2Temp ?? fallback.s2Temp,
          s2Hum: apiReading?.s2Hum ?? fallback.s2Hum,
          s2Pres: apiReading?.s2Pres ?? fallback.s2Pres,
          s3Gas: apiReading?.s3Gas ?? fallback.s3Gas,
          s3Temp: apiReading?.s3Temp ?? fallback.s3Temp,
          s3Hum: apiReading?.s3Hum ?? fallback.s3Hum,
          s3Pres: apiReading?.s3Pres ?? fallback.s3Pres,
          s4Gas: apiReading?.s4Gas ?? fallback.s4Gas,
          s4Temp: apiReading?.s4Temp ?? fallback.s4Temp,
          s4Hum: apiReading?.s4Hum ?? fallback.s4Hum,
          s4Pres: apiReading?.s4Pres ?? fallback.s4Pres,
        };

        const updated = [...readingsRef.current, newPoint];
        readingsRef.current = updated;
        onSetActiveReadings(() => updated);
        setSampleCount(elapsed);

        if (nextSec <= 0) {
          setIsRecordingActive(false);
          setCurrentStep(6);
          void finalizeSession(updated);
        }
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentStep, isRecordingActive, participant.diagnosis]);

  const handleStep2Continue = () => {
    if (!participant.participantId.trim() || !participant.sampleId.trim()) {
      setFormError('Participant ID and Sample ID are required before continuing.');
      return;
    }
    if (!participant.age || participant.age <= 0 || participant.age > 120) {
      setFormError('Please enter a valid biological age (1–120 years).');
      return;
    }
    setFormError(null);
    setCurrentStep(3);
  };

  const handleSaveAndFinish = () => {
    setIsRecordingActive(false);
    setCurrentStep(6);
    void finalizeSession(readingsRef.current);
  };

  const resetWizard = () => {
    sessionSavedRef.current = false;
    setSavedDatasetId(undefined);
    setClassificationResult(null);
    setClassificationError(null);
    setIsClassifying(false);
    setCurrentStep(1);
    setStabilizationSeconds(TOTAL_STABILIZATION_SEC);
    setStabilizationProgress(0);
    setRecordingSeconds(TOTAL_RECORDING_SEC);
    setSampleCount(0);
    setIsRecordingActive(false);
    setFocusedSensor(null);
    onSetActiveReadings(() => []);
    setPrepChecklist({
      chamberCleaned: false,
      sampleInserted: false,
      chamberSealed: false,
      filterActive: false,
    });
  };

  const skipStabilization = () => {
    sessionSavedRef.current = false;
    setStabilizationSeconds(0);
    setStabilizationProgress(100);
    setCurrentStep(5);
    setIsRecordingActive(true);
  };

  const fastForwardRecording = () => {
    const currentElapsed = TOTAL_RECORDING_SEC - recordingSeconds;
    const pointsToAdd: LiveDataPoint[] = [];
    const baseTime = Date.now();

    for (let s = currentElapsed + 1; s <= TOTAL_RECORDING_SEC; s++) {
      const readings = generateSensorDataPoint(s, participant.diagnosis);
      const timeVal = new Date(baseTime + s * 1000);
      pointsToAdd.push({
        timestamp: timeVal.toTimeString().split(' ')[0],
        elapsed: s,
        ...readings,
      });
    }

    const combined = [...readingsRef.current, ...pointsToAdd];
    readingsRef.current = combined;
    onSetActiveReadings(() => combined);
    setRecordingSeconds(0);
    setSampleCount(TOTAL_RECORDING_SEC);
    setIsRecordingActive(false);
    setCurrentStep(6);
    void finalizeSession(combined);
  };

  const exportSessionCsv = () => {
    const headers = [
      'Timestamp',
      'Elapsed_Sec',
      'S1_Gas_kOhm',
      'S1_Temp_C',
      'S1_Hum_RH',
      'S1_Pres_hPa',
      'S2_Gas_kOhm',
      'S2_Temp_C',
      'S2_Hum_RH',
      'S2_Pres_hPa',
      'S3_Gas_kOhm',
      'S3_Temp_C',
      'S3_Hum_RH',
      'S3_Pres_hPa',
      'S4_Gas_kOhm',
      'S4_Temp_C',
      'S4_Hum_RH',
      'S4_Pres_hPa',
    ];
    const rows = activeReadings.map((r) => [
      r.timestamp,
      r.elapsed,
      r.s1Gas,
      r.s1Temp,
      r.s1Hum,
      r.s1Pres,
      r.s2Gas,
      r.s2Temp,
      r.s2Hum,
      r.s2Pres,
      r.s3Gas,
      r.s3Temp,
      r.s3Hum,
      r.s3Pres,
      r.s4Gas,
      r.s4Temp,
      r.s4Hum,
      r.s4Pres,
    ]);
    const csv =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute(
      'download',
      `VOC_${participant.diagnosis.toUpperCase()}_${participant.participantId}_${participant.sampleId}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const latestReading = activeReadings[activeReadings.length - 1];
  const allPrepChecked =
    prepChecklist.chamberCleaned &&
    prepChecklist.sampleInserted &&
    prepChecklist.chamberSealed &&
    prepChecklist.filterActive;

  // Simulated hotplate ramp temperature during Step 4
  const hotplateTemp = Math.round(28 + (stabilizationProgress / 100) * 292);

  const steps = [
    { num: 1, label: 'Device Connection', code: 'ESP32', icon: Usb },
    { num: 2, label: 'Participant Info', code: 'COHORT', icon: User },
    { num: 3, label: 'Sample Prep', code: 'CHAMBER', icon: Beaker },
    { num: 4, label: 'Stabilization', code: '320°C', icon: Compass },
    { num: 5, label: 'Recording', code: '1.0 HZ', icon: Clock },
    { num: 6, label: 'Finished', code: 'EXPORT', icon: CheckCircle2 },
  ];

  const canJumpToStep = (targetNum: number) => {
    if (currentStep === 4 || currentStep === 5 || currentStep === 6) return false;
    return targetNum < currentStep;
  };

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 sm:p-6 flex flex-col h-full shadow-xs">
      {/* Desktop Horizontal Stepper Bar */}
      <div className="hidden lg:flex items-center justify-between border-b border-zinc-200 pb-5 mb-6">
        {steps.map((s, idx) => {
          const Icon = s.icon;
          const isActive = currentStep === s.num;
          const isCompleted = currentStep > s.num;
          const clickable = canJumpToStep(s.num);
          return (
            <div key={s.num} className="flex items-center flex-1 last:flex-initial">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setCurrentStep(s.num)}
                className={`flex items-center gap-2.5 text-left group ${
                  clickable ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-all ${
                    isActive
                      ? 'bg-black border-black text-white shadow-xs'
                      : isCompleted
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-zinc-50 border-zinc-200 text-zinc-400'
                  }`}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <div>
                  <p
                    className={`text-xs font-semibold leading-tight ${
                      isActive
                        ? 'text-black'
                        : isCompleted
                        ? 'text-zinc-800'
                        : 'text-zinc-400'
                    }`}
                  >
                    {s.label}
                  </p>
                  <p className="text-[9px] text-zinc-400 font-mono uppercase tracking-wider mt-0.5">
                    0{s.num} • {s.code}
                  </p>
                </div>
              </button>
              {idx < steps.length - 1 && (
                <div
                  className={`h-0.5 flex-1 mx-3 rounded-full transition-all ${
                    isCompleted ? 'bg-emerald-500' : 'bg-zinc-200'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile / Tablet Compact Stepper Header */}
      <div className="lg:hidden flex items-center justify-between border-b border-zinc-200 pb-3.5 mb-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-mono text-white bg-black px-2.5 py-1 rounded-md font-semibold">
            {currentStep}/6
          </span>
          <div>
            <h4 className="font-sans font-semibold text-sm text-black">
              {steps[currentStep - 1].label}
            </h4>
            <p className="text-[10px] font-mono text-zinc-400 uppercase">
              Phase 0{currentStep} • {steps[currentStep - 1].code}
            </p>
          </div>
        </div>
        <div className="w-28 bg-zinc-100 h-2 rounded-full overflow-hidden border border-zinc-200">
          <div
            className="bg-black h-full transition-all duration-300"
            style={{ width: `${(currentStep / 6) * 100}%` }}
          />
        </div>
      </div>

      {/* Step Panels */}
      <div className="flex-1 flex flex-col justify-between">
        {/* STEP 1: DEVICE CONNECTION */}
        {currentStep === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 py-2">
            <div className="lg:col-span-6 space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-semibold text-lg text-black tracking-tight">
                    1. Device Connection
                  </h3>
                  <span
                    className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold border ${
                      espStatus === 'Online'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : espStatus === 'Handshaking'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                    }`}
                  >
                    ESP32: {espStatus.toUpperCase()}
                  </span>
                </div>

                <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                  Establish a serial telemetry link with the ESP32-WROOM-32E controller and PCA9548A 4-channel sensor multiplexer via Web Serial API or local COM bridge.
                </p>

                {/* ESP32 Hardware Status Cards */}
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <div className="flex items-center gap-1.5 text-zinc-400 text-[9px] font-mono uppercase">
                      <Cpu className="w-3 h-3" />
                      <span>MCU</span>
                    </div>
                    <p className="font-mono text-[11px] font-bold text-black mt-1">ESP32-WROOM</p>
                  </div>
                  <div className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <div className="flex items-center gap-1.5 text-zinc-400 text-[9px] font-mono uppercase">
                      <Radio className="w-3 h-3" />
                      <span>Baud Rate</span>
                    </div>
                    <p className="font-mono text-[11px] font-bold text-black mt-1">{baudRate} bps</p>
                  </div>
                  <div className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <div className="flex items-center gap-1.5 text-zinc-400 text-[9px] font-mono uppercase">
                      <Usb className="w-3 h-3" />
                      <span>Array</span>
                    </div>
                    <p className="font-mono text-[11px] font-bold text-black mt-1">4× BME680</p>
                  </div>
                </div>

                {/* COM Port & Action */}
                <div className="space-y-3 bg-zinc-50/70 border border-zinc-200 rounded-xl p-4">
                  <div>
                    <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                      Target COM Port
                    </label>
                    <select
                      value={comPort}
                      onChange={(e) => setComPort(e.target.value)}
                      disabled={isDeviceConnected}
                      className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-black text-black"
                    >
                      <option value="COM3">COM3 — ESP32-WROOM-32E USB-UART (Recommended)</option>
                      <option value="COM1">COM1 — Standard Serial Port</option>
                      <option value="COM4">COM4 — Silicon Labs CP210x / CH340</option>
                      <option value="/dev/ttyUSB0">/dev/ttyUSB0 — Linux UART Bridge</option>
                      <option value="VirtualPort">Virtual Lab Chamber Simulator</option>
                    </select>
                  </div>

                  {!isDeviceConnected ? (
                    <button
                      type="button"
                      onClick={initiateConnection}
                      disabled={espStatus === 'Handshaking'}
                      className="w-full bg-black hover:bg-zinc-800 active:scale-[0.99] text-white py-2.5 px-4 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      <Usb className="w-4 h-4" />
                      <span>
                        {espStatus === 'Handshaking'
                          ? 'Handshaking Serial Port...'
                          : 'Connect ESP32 Controller'}
                      </span>
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs p-2.5 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 font-medium">
                        <span className="flex items-center gap-1.5 font-mono text-[11px]">
                          <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                          Linked on {comPort}
                        </span>
                        <span className="font-mono text-[10px] font-bold">READY</span>
                      </div>
                      <button
                        type="button"
                        onClick={disconnectDevice}
                        className="w-full bg-white hover:bg-zinc-100 text-zinc-700 py-2 px-4 rounded-lg text-xs font-semibold transition-all cursor-pointer border border-zinc-200"
                      >
                        Disconnect Hardware
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Serial Terminal Log */}
              <div className="flex flex-col h-[145px] bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden font-mono text-[10px] text-zinc-300 p-3.5">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2 text-zinc-400 uppercase tracking-widest text-[9px] font-semibold">
                  <span>COM SERIAL TELEMETRY ({comPort})</span>
                  <span className="text-zinc-500">UART 8N1</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1">
                  {connectionLog.map((log, idx) => (
                    <p key={idx} className="leading-snug">
                      <span className="text-zinc-500">[{new Date().toLocaleTimeString()}]</span>{' '}
                      {log}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            {/* Interactive 3D Hardware View */}
            <div className="lg:col-span-6 flex flex-col justify-between space-y-2">
              <Chamber3DView
                isConnected={isDeviceConnected}
                hasSample={false}
                isLidOpen={false}
                focusTarget="esp32"
              />
              <p className="text-[10px] font-mono text-zinc-400 text-center">
                Interactive 3D Twin • Drag to orbit, scroll to zoom, or click sensor channels
              </p>
            </div>
          </div>
        )}

        {/* STEP 2: PARTICIPANT INFORMATION */}
        {currentStep === 2 && (
          <div className="py-2 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-black" />
                <h3 className="font-display font-semibold text-lg text-black tracking-tight">
                  2. Participant Information & Cohort Metadata
                </h3>
              </div>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 border border-zinc-200 px-2.5 py-1 rounded-md self-start sm:self-auto">
                17-Channel Clinical Header
              </span>
            </div>

            <p className="text-xs text-zinc-500 leading-relaxed max-w-2xl font-sans">
              Enter clinical trial subject identifiers and laboratory metadata. These fields are embedded into the exported VOC telemetry matrix for downstream Support Vector Machine (SVM) classification.
            </p>

            {formError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-sans">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-zinc-50/70 border border-zinc-200 rounded-xl p-5">
              <div>
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Participant ID *
                </label>
                <input
                  type="text"
                  value={participant.participantId}
                  onChange={(e) =>
                    setParticipant({ ...participant, participantId: e.target.value })
                  }
                  placeholder="e.g. SUBJ-001"
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-black text-black font-mono font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Sample ID *
                </label>
                <input
                  type="text"
                  value={participant.sampleId}
                  onChange={(e) => setParticipant({ ...participant, sampleId: e.target.value })}
                  placeholder="e.g. SEB-001"
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-black text-black font-mono font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Diagnosis Cohort
                </label>
                <select
                  value={participant.diagnosis}
                  onChange={(e) =>
                    setParticipant({
                      ...participant,
                      diagnosis: e.target.value as 'Healthy' | 'Parkinson',
                    })
                  }
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-black text-black"
                >
                  <option value="Parkinson">Parkinson Disease</option>
                  <option value="Healthy">Healthy Control</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Age (Years) *
                </label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={participant.age}
                  onChange={(e) =>
                    setParticipant({ ...participant, age: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-black text-black"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Gender
                </label>
                <select
                  value={participant.gender}
                  onChange={(e) =>
                    setParticipant({ ...participant, gender: e.target.value as any })
                  }
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-black text-black"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Operator Name
                </label>
                <input
                  type="text"
                  value={participant.operatorName}
                  onChange={(e) =>
                    setParticipant({ ...participant, operatorName: e.target.value })
                  }
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-black text-black"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Institution / Laboratory
                </label>
                <input
                  type="text"
                  value={participant.institution}
                  onChange={(e) => setParticipant({ ...participant, institution: e.target.value })}
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-black text-black"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Collection Date
                </label>
                <input
                  type="date"
                  value={participant.collectionDate}
                  onChange={(e) =>
                    setParticipant({ ...participant, collectionDate: e.target.value })
                  }
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-black text-black"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                  Notes / Clinical Observations
                </label>
                <textarea
                  value={participant.notes}
                  rows={2}
                  onChange={(e) => setParticipant({ ...participant, notes: e.target.value })}
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-black text-black font-sans"
                  placeholder="Sebum swab collection site (upper back), ambient humidity notes, medication window..."
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: SAMPLE PREPARATION */}
        {currentStep === 3 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 py-2">
            <div className="lg:col-span-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Beaker className="w-5 h-5 text-black" />
                  <h3 className="font-display font-semibold text-lg text-black tracking-tight">
                    3. Sample Preparation
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPrepChecklist({
                      chamberCleaned: true,
                      sampleInserted: true,
                      chamberSealed: true,
                      filterActive: true,
                    })
                  }
                  className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border border-zinc-200 cursor-pointer transition-colors"
                >
                  Verify All
                </button>
              </div>

              <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                Complete each containment verification step below. The 3D chamber twin updates dynamically as the sebum swab is placed, charcoal filter is engaged, and acrylic canopy is sealed.
              </p>

              <div className="space-y-2.5 bg-zinc-50/70 p-4 border border-zinc-200 rounded-xl">
                {[
                  {
                    key: 'chamberCleaned' as const,
                    title: '1. Purge & clean chamber headspace',
                    desc: 'Flush acrylic enclosure with zero-air charcoal stream for 60s to clear residual VOCs.',
                  },
                  {
                    key: 'sampleInserted' as const,
                    title: '2. Position skin sebum swab on sterile dish',
                    desc: 'Place the 100μL upper-back sebum cotton swab squarely inside the central ceramic plate.',
                  },
                  {
                    key: 'chamberSealed' as const,
                    title: '3. Lower & seal transparent acrylic canopy',
                    desc: 'Engage airtight latch around the anodized rim so headspace concentration stabilizes.',
                  },
                  {
                    key: 'filterActive' as const,
                    title: '4. Confirm activated charcoal inlet cartridge',
                    desc: 'Verify top intake cartridge is seated to scrub ambient background hydrocarbons.',
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      prepChecklist[item.key]
                        ? 'bg-emerald-50/50 border-emerald-200'
                        : 'bg-white border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={prepChecklist[item.key]}
                      onChange={(e) =>
                        setPrepChecklist({ ...prepChecklist, [item.key]: e.target.checked })
                      }
                      className="mt-0.5 w-4 h-4 rounded accent-black cursor-pointer"
                    />
                    <div>
                      <p className="text-xs font-semibold text-black">{item.title}</p>
                      <p className="text-[11px] text-zinc-500 font-sans mt-0.5">{item.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="lg:col-span-6 flex flex-col justify-between space-y-2">
              <Chamber3DView
                isConnected={isDeviceConnected}
                hasSample={prepChecklist.sampleInserted}
                isLidOpen={!prepChecklist.chamberSealed}
                isPurging={prepChecklist.chamberCleaned && !prepChecklist.chamberSealed}
                filterMounted={prepChecklist.filterActive}
                focusTarget="iso"
              />
              <p className="text-[10px] font-mono text-zinc-400 text-center">
                {!prepChecklist.chamberSealed
                  ? 'Canopy lid unsealed for swab loading • Check Step 3 to seal chamber'
                  : 'Chamber airtight • Ready for thermal stabilization'}
              </p>
            </div>
          </div>
        )}

        {/* STEP 4: SENSOR STABILIZATION */}
        {currentStep === 4 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 py-2">
            <div className="lg:col-span-6 space-y-4 flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-amber-600 animate-spin" />
                <h3 className="font-display font-semibold text-lg text-black tracking-tight">
                  4. Sensor Thermal Stabilization
                </h3>
              </div>

              <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                Heating the 4× Bosch BME680 metal-oxide hotplates to <span className="font-mono font-semibold text-black">320°C</span> to achieve baseline conductance equilibrium before volatile desorption logging begins.
              </p>

              <div className="bg-zinc-50/70 border border-zinc-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Circular Progress Ring */}
                    <div className="relative w-16 h-16 flex items-center justify-center">
                      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                        <circle
                          cx="32"
                          cy="32"
                          r="26"
                          fill="none"
                          stroke="#e4e4e7"
                          strokeWidth="5"
                        />
                        <circle
                          cx="32"
                          cy="32"
                          r="26"
                          fill="none"
                          stroke="#d97706"
                          strokeWidth="5"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 26}
                          strokeDashoffset={
                            2 * Math.PI * 26 * (1 - stabilizationProgress / 100)
                          }
                          className="transition-all duration-700 ease-linear"
                        />
                      </svg>
                      <span className="absolute font-mono text-xs font-bold text-black">
                        {stabilizationProgress}%
                      </span>
                    </div>

                    <div>
                      <span className="block text-[10px] font-mono uppercase text-zinc-500 font-semibold">
                        Countdown Remaining
                      </span>
                      <p className="font-display text-2xl font-bold text-black tracking-tight">
                        {stabilizationSeconds}s
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="block text-[10px] font-mono uppercase text-zinc-500 font-semibold">
                      Hotplate Ramp
                    </span>
                    <p className="font-mono text-lg font-bold text-amber-700">
                      {hotplateTemp}°C / 320°C
                    </p>
                  </div>
                </div>

                {/* Linear Progress Bar */}
                <div className="w-full bg-zinc-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-600 h-full transition-all duration-700 ease-linear"
                    style={{ width: `${stabilizationProgress}%` }}
                  />
                </div>

                <div className="flex items-center gap-2.5 p-3 bg-white border border-zinc-200 text-zinc-600 rounded-lg text-xs font-sans">
                  <Info className="w-4 h-4 flex-shrink-0 text-zinc-700" />
                  <p>Fast-forward bypass is enabled for training or rapid clinical preview runs.</p>
                </div>

                <button
                  type="button"
                  onClick={skipStabilization}
                  className="w-full bg-white hover:bg-zinc-100 text-black py-2 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer border border-zinc-200 flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <FastForward className="w-3.5 h-3.5" />
                  <span>Fast-Forward Stabilization</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 flex flex-col justify-between space-y-2">
              <Chamber3DView
                isConnected={isDeviceConnected}
                isStabilizing={true}
                hasSample={true}
                isLidOpen={false}
                focusTarget="sensors"
              />
              <p className="text-[10px] font-mono text-zinc-400 text-center">
                BME680 micro-hotplates warming • Thermal convection active inside sealed chamber
              </p>
            </div>
          </div>
        )}

        {/* STEP 5: ACTIVE RECORDING */}
        {currentStep === 5 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 py-2">
            <div className="lg:col-span-6 space-y-4 flex flex-col justify-center">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isRecordingActive ? 'bg-red-600' : 'bg-amber-500'
                    }`}
                  />
                  <h3 className="font-display font-semibold text-lg text-black tracking-tight">
                    5. Live VOC Recording
                  </h3>
                </div>
                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-700">
                  {isRecordingActive ? 'SAMPLING @ 1.0 HZ' : 'PAUSED'}
                </span>
              </div>

              <p className="text-xs text-zinc-500 leading-relaxed font-sans">
                Logging 17 volatile & environmental channels for{' '}
                <span className="font-mono font-semibold text-black">
                  {participant.participantId}
                </span>{' '}
                ({participant.diagnosis}). Click any channel card below to focus it in the 3D chamber.
              </p>

              <div className="bg-zinc-50/70 border border-zinc-200 rounded-xl p-4 space-y-3.5">
                {/* Countdown & Frames */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-white border border-zinc-200 rounded-lg text-center">
                    <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                      Timer Remaining
                    </p>
                    <p className="font-display font-bold text-2xl text-black mt-0.5">
                      {Math.floor(recordingSeconds / 60)}:
                      {(recordingSeconds % 60).toString().padStart(2, '0')}
                    </p>
                  </div>
                  <div className="p-3 bg-white border border-zinc-200 rounded-lg text-center">
                    <p className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                      Samples Logged
                    </p>
                    <p className="font-display font-bold text-2xl text-black mt-0.5">
                      {sampleCount} <span className="text-xs text-zinc-400 font-mono">/ 300</span>
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-zinc-200 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ease-linear ${
                      isRecordingActive ? 'bg-emerald-600' : 'bg-amber-500'
                    }`}
                    style={{ width: `${(sampleCount / TOTAL_RECORDING_SEC) * 100}%` }}
                  />
                </div>

                {/* Live 4-Channel Sensor Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    {
                      ch: 1,
                      gas: latestReading?.s1Gas,
                      temp: latestReading?.s1Temp,
                      hum: latestReading?.s1Hum,
                    },
                    {
                      ch: 2,
                      gas: latestReading?.s2Gas,
                      temp: latestReading?.s2Temp,
                      hum: latestReading?.s2Hum,
                    },
                    {
                      ch: 3,
                      gas: latestReading?.s3Gas,
                      temp: latestReading?.s3Temp,
                      hum: latestReading?.s3Hum,
                    },
                    {
                      ch: 4,
                      gas: latestReading?.s4Gas,
                      temp: latestReading?.s4Temp,
                      hum: latestReading?.s4Hum,
                    },
                  ].map((s) => {
                    const isFocused = focusedSensor === s.ch;
                    return (
                      <button
                        key={s.ch}
                        type="button"
                        onClick={() => setFocusedSensor(isFocused ? null : s.ch)}
                        className={`p-2.5 rounded-lg border text-left font-mono transition-all cursor-pointer ${
                          isFocused
                            ? 'bg-zinc-900 text-white border-black'
                            : 'bg-white text-black border-zinc-200 hover:border-zinc-400'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[9px] opacity-70">
                          <span>CH{s.ch}</span>
                          <span>{s.temp ?? '--'}°C</span>
                        </div>
                        <p className="text-xs font-bold mt-1">
                          {s.gas ?? '---'} <span className="text-[9px] font-normal">kΩ</span>
                        </p>
                        <p className="text-[9px] opacity-60 mt-0.5">{s.hum ?? '--'}% RH</p>
                      </button>
                    );
                  })}
                </div>

                {/* Pause / Resume & Stop Controls */}
                <div className="flex items-center gap-2 pt-1">
                  {isRecordingActive ? (
                    <button
                      type="button"
                      onClick={() => setIsRecordingActive(false)}
                      className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsRecordingActive(true)}
                      className="flex-1 bg-black hover:bg-zinc-800 text-white py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Resume</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveAndFinish}
                    className="flex-1 bg-zinc-900 hover:bg-black text-white py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop & Save</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={fastForwardRecording}
                  className="w-full bg-white hover:bg-zinc-100 text-zinc-700 py-1.5 rounded-lg text-[10px] font-mono font-semibold transition-all cursor-pointer border border-zinc-200 flex items-center justify-center gap-1 shadow-xs"
                >
                  <FastForward className="w-3 h-3" />
                  <span>Instantly Complete 300s Acquisition</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 flex flex-col justify-between space-y-2">
              <Chamber3DView
                isConnected={isDeviceConnected}
                isRecording={isRecordingActive}
                hasSample={true}
                isLidOpen={false}
                activeSensor={focusedSensor}
                onSelectSensor={setFocusedSensor}
                focusTarget="iso"
              />
              <p className="text-[10px] font-mono text-zinc-400 text-center">
                {focusedSensor
                  ? `Inspecting Channel CH${focusedSensor} • Click again or select ALL to reset`
                  : 'Live volatile desorption flow • Click CH1–CH4 in the 3D scene to isolate'}
              </p>
            </div>
          </div>
        )}

        {/* STEP 6: RECORDING FINISHED & SVM CLASSIFICATION RESULT */}
        {currentStep === 6 && (
          <div className="py-2 space-y-5">
            {/* Clean Clinical Session Header & Export Actions */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 pb-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-500">
                  <span className="text-black font-semibold">Akuisisi Selesai</span>
                  <span className="text-zinc-300">·</span>
                  <span>{participant.participantId}</span>
                  <span className="text-zinc-300">·</span>
                  <span>{participant.sampleId}</span>
                  <span className="text-zinc-300">·</span>
                  <span>{activeReadings.length} frames × 4× BME680</span>
                </div>
                <h3 className="font-display font-semibold text-xl text-black tracking-tight">
                  6. Recording Finished & Machine Learning Classification
                </h3>
                <p className="text-xs text-zinc-500">
                  Operator: {participant.operatorName} · {participant.institution} · {participant.collectionDate}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={exportSessionCsv}
                  className="bg-black hover:bg-zinc-800 text-white py-2 px-3.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenDataset?.(savedDatasetId)}
                  className="bg-white hover:bg-zinc-100 text-black py-2 px-3.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer border border-zinc-300 whitespace-nowrap shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Open Dataset</span>
                </button>

                <button
                  type="button"
                  onClick={resetWizard}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 py-2 px-3.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer border border-zinc-200 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>New Run</span>
                </button>
              </div>
            </div>

            {/* Real SVM Classification Visualization */}
            <ClassificationResultPanel
              result={classificationResult}
              isLoading={isClassifying}
              error={classificationError}
              participant={participant}
              onRetry={() => void runClassification(readingsRef.current)}
            />
          </div>
        )}

        {/* WIZARD FOOTER NAVIGATION */}
        {currentStep < 6 && (
          <div className="flex items-center justify-between border-t border-zinc-200 pt-4 mt-6">
            <button
              type="button"
              onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
              disabled={currentStep === 1 || currentStep === 4 || currentStep === 5}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-zinc-50 text-zinc-600 hover:bg-zinc-100 hover:text-black transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-zinc-200"
            >
              Back
            </button>

            {currentStep === 1 && (
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                disabled={!isDeviceConnected}
                className="bg-black hover:bg-zinc-800 active:scale-[0.99] text-white font-semibold text-xs py-2 px-5 rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Continue to Participant Info</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 2 && (
              <button
                type="button"
                onClick={handleStep2Continue}
                className="bg-black hover:bg-zinc-800 active:scale-[0.99] text-white font-semibold text-xs py-2 px-5 rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue to Sample Prep</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 3 && (
              <button
                type="button"
                onClick={() => setCurrentStep(4)}
                disabled={!allPrepChecked}
                className="bg-black hover:bg-zinc-800 active:scale-[0.99] text-white font-semibold text-xs py-2 px-5 rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Verify all preparation steps to begin stabilization"
              >
                <span>Start Stabilization</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 4 && (
              <span className="font-mono text-[11px] text-amber-700 font-semibold">
                Stabilizing BME680 heaters ({stabilizationSeconds}s)...
              </span>
            )}

            {currentStep === 5 && (
              <span className="font-mono text-[11px] text-zinc-600 font-semibold">
                {isRecordingActive
                  ? `Recording frame ${sampleCount}/300...`
                  : 'Recording paused — resume or stop to finish'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
