/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClassificationResult, ParticipantInfo } from '../types';
import { RotateCcw } from 'lucide-react';

interface ClassificationResultPanelProps {
  result: ClassificationResult | null;
  isLoading: boolean;
  error: string | null;
  participant: ParticipantInfo;
  onRetry?: () => void;
}

export default function ClassificationResultPanel({
  result,
  isLoading,
  error,
  participant,
  onRetry,
}: ClassificationResultPanelProps) {
  if (isLoading) {
    return (
      <div className="w-full rounded-xl border border-zinc-200 bg-white p-6 sm:p-8">
        <div className="flex items-center gap-3.5 text-zinc-800">
          <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-black">
              Menjalankan Preprocessing & Klasifikasi SVM
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Mengekstrak fitur kurva desorpsi 4 sensor BME680 dan menghitung probabilitas terkalibrasi...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="w-full rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-black">
              Klasifikasi SVM Tidak Dapat Diproses
            </p>
            <p className="text-xs text-zinc-600 mt-1">
              {error || 'Data respons sensor BME680 belum tersedia untuk inferensi model.'}
            </p>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-4 py-2 rounded-lg bg-black hover:bg-zinc-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors self-start sm:self-auto whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Ulangi Klasifikasi</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const isParkinson = result.predictedClass === 'Parkinson';
  const parkinsonPct = result.parkinsonProbability;
  const nonParkinsonPct = result.nonParkinsonProbability;

  // Donut chart geometry (r = 52, refined thin 11px stroke)
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const parkinsonStroke = (parkinsonPct / 100) * circumference;
  const nonParkinsonStroke = (nonParkinsonPct / 100) * circumference;

  const formattedTestedAt = (() => {
    const dt = new Date(result.testedAt);
    if (Number.isNaN(dt.getTime())) return result.testedAt;
    return dt.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  })();

  const confidenceLabel =
    result.confidenceLevel === 'High'
      ? 'Keyakinan Tinggi'
      : result.confidenceLevel === 'Moderate'
      ? 'Keyakinan Moderat'
      : 'Perlu Tinjauan Lanjut';

  return (
    <div className="w-full space-y-5 text-left">
      {/* 1. CLASSIFICATION RESULT CARD (Pure Monochrome Polarity) */}
      <div
        className={`rounded-xl border p-6 sm:p-7 transition-colors ${
          isParkinson
            ? 'bg-zinc-950 border-zinc-900 text-white'
            : 'bg-zinc-50 border-zinc-300 text-black'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2.5">
            <div
              className={`flex flex-wrap items-center gap-2 text-xs font-mono ${
                isParkinson ? 'text-zinc-400' : 'text-zinc-500'
              }`}
            >
              <span>Machine Learning Classification Result</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{participant.participantId}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{participant.sampleId}</span>
            </div>

            <div className="space-y-1">
              <h3
                className={`font-display text-3xl sm:text-4xl font-semibold tracking-tight ${
                  isParkinson ? 'text-white' : 'text-black'
                }`}
              >
                {result.predictedClass}
              </h3>
              <p
                className={`text-xs font-medium ${
                  isParkinson ? 'text-zinc-300' : 'text-zinc-700'
                }`}
              >
                {isParkinson
                  ? 'Status: Terdeteksi kecenderungan pola VOC kelas Parkinson'
                  : 'Status: Pola VOC berada pada profil kelas Non-Parkinson'}
              </p>
            </div>

            <p
              className={`text-xs leading-relaxed max-w-xl ${
                isParkinson ? 'text-zinc-400' : 'text-zinc-500'
              }`}
            >
              Prediksi kelas diturunkan langsung dari fungsi keputusan model SVM terlatih dan dikalibrasi menjadi probabilitas kelas menggunakan metode Platt Scaling.
            </p>
          </div>

          {/* Model Confidence Readout */}
          <div
            className={`md:text-right border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-7 flex-shrink-0 ${
              isParkinson ? 'border-zinc-800' : 'border-zinc-200'
            }`}
          >
            <span
              className={`block text-[11px] font-medium ${
                isParkinson ? 'text-zinc-400' : 'text-zinc-500'
              }`}
            >
              Model Confidence
            </span>
            <p
              className={`font-mono tabular-nums text-3xl sm:text-4xl font-semibold tracking-tight mt-0.5 ${
                isParkinson ? 'text-white' : 'text-black'
              }`}
            >
              {result.modelConfidence.toFixed(1)}%
            </p>
            <span
              className={`block text-[11px] font-medium mt-1 ${
                isParkinson ? 'text-zinc-300' : 'text-zinc-700'
              }`}
            >
              {confidenceLabel}
            </span>
          </div>
        </div>
      </div>

      {/* 2. PROBABILITY DISTRIBUTION & 3. ANALYSIS SUMMARY */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Probability Distribution Card */}
        <div className="lg:col-span-7 rounded-xl border border-zinc-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between border-b border-zinc-100 pb-3.5 mb-6">
              <div>
                <h4 className="text-sm font-semibold text-black">
                  Probability Distribution
                </h4>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Distribusi probabilitas terkalibrasi antara kelas target
                </p>
              </div>
              <span className="font-mono tabular-nums text-xs font-medium text-zinc-500">
                {(parkinsonPct + nonParkinsonPct).toFixed(1)}% Total
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-7">
              {/* Monochrome Donut Ring */}
              <div className="relative w-32 h-32 flex-shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 132 132" className="w-full h-full -rotate-90">
                  <circle
                    cx="66"
                    cy="66"
                    r={radius}
                    fill="none"
                    stroke="#f4f4f5"
                    strokeWidth="11"
                  />
                  {/* Non-Parkinson arc (Cool Silver Gray) */}
                  <circle
                    cx="66"
                    cy="66"
                    r={radius}
                    fill="none"
                    stroke="#d4d4d8"
                    strokeWidth="11"
                    strokeDasharray={`${nonParkinsonStroke} ${circumference}`}
                    strokeDashoffset={-parkinsonStroke}
                    className="transition-all duration-500 ease-out"
                  />
                  {/* Parkinson arc (Solid Black) */}
                  <circle
                    cx="66"
                    cy="66"
                    r={radius}
                    fill="none"
                    stroke="#09090b"
                    strokeWidth="11"
                    strokeDasharray={`${parkinsonStroke} ${circumference}`}
                    strokeDashoffset={0}
                    className="transition-all duration-500 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] text-zinc-400">Dominan</span>
                  <span className="font-mono tabular-nums text-base font-semibold text-black">
                    {result.modelConfidence.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Side-by-Side Horizontal Progress Bars */}
              <div className="flex-1 w-full space-y-5">
                {/* Parkinson Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-zinc-950 inline-block" />
                      <span className="font-semibold text-black">Parkinson</span>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-black">
                      {parkinsonPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-zinc-950 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${parkinsonPct}%` }}
                    />
                  </div>
                </div>

                {/* Non-Parkinson Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-zinc-300 border border-zinc-400 inline-block" />
                      <span className="font-semibold text-zinc-700">Non-Parkinson</span>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-zinc-700">
                      {nonParkinsonPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-zinc-400 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${nonParkinsonPct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Preprocessed BME680 Feature Readout (Clean hairline columns, zero nested boxes) */}
          <div className="mt-7 pt-5 border-t border-zinc-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-medium text-zinc-500">
                Fitur Desorpsi BME680 (Input Pipeline SVM)
              </span>
              <span className="font-mono tabular-nums text-[10px] text-zinc-400">
                16 fitur · StandardScaler
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
              {result.channelSummary.map((ch) => (
                <div
                  key={ch.channel}
                  className="sm:border-r sm:last:border-r-0 border-zinc-100 sm:pr-3"
                >
                  <span className="block font-mono text-[10px] text-zinc-400">
                    {ch.channel} ΔR/R₀
                  </span>
                  <span className="block font-mono tabular-nums text-sm font-semibold text-black mt-0.5">
                    {ch.deltaRatioPct.toFixed(1)}%
                  </span>
                  <span className="block font-mono tabular-nums text-[10px] text-zinc-400 mt-0.5">
                    {ch.baselineKOhm} → {ch.minKOhm} kΩ
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Analysis Summary Card */}
        <div className="lg:col-span-5 rounded-xl border border-zinc-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-baseline justify-between border-b border-zinc-100 pb-3.5 mb-3">
              <h4 className="text-sm font-semibold text-black">Analysis Summary</h4>
              <span className="font-mono text-[10px] text-zinc-400">SVM Inference</span>
            </div>

            <dl className="divide-y divide-zinc-100 text-xs">
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Classification Result</dt>
                <dd className="font-semibold text-black">{result.predictedClass}</dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Status Proses</dt>
                <dd className="font-medium text-black">Analisis Berhasil</dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Waktu Pengujian</dt>
                <dd className="font-mono tabular-nums text-zinc-800 text-right">
                  {formattedTestedAt}
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Algoritma Model</dt>
                <dd className="font-medium text-zinc-800 text-right">{result.algorithm}</dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Kalibrasi Probabilitas</dt>
                <dd className="font-medium text-zinc-800 text-right">Platt Scaling (5-Fold)</dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Frame Dianalisis</dt>
                <dd className="font-mono tabular-nums text-zinc-800">
                  {result.framesAnalyzed} frame × 4 sensor
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-zinc-500">SVM Decision Score</dt>
                <dd className="font-mono tabular-nums text-zinc-800">
                  {result.decisionScore >= 0 ? '+' : ''}
                  {result.decisionScore.toFixed(4)}
                </dd>
              </div>
            </dl>
          </div>

          <p className="mt-4 pt-3 border-t border-zinc-100 text-[11px] text-zinc-500 leading-relaxed">
            Seluruh nilai di atas merupakan keluaran aktual model machine learning ParkinSense berdasarkan data respons gas BME680 hasil akuisisi.
          </p>
        </div>
      </div>

      {/* 4. MEDICAL DISCLAIMER */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 text-xs text-zinc-600 leading-relaxed">
        <span className="font-semibold text-black block mb-1">
          Catatan Medis & Batasan Skrining
        </span>
        <p>
          Hasil klasifikasi ini merupakan keluaran algoritma machine learning berdasarkan pola respons sensor terhadap VOC pada sampel yang diuji. Hasil tidak menggantikan pemeriksaan dan diagnosis oleh dokter spesialis neurologi.
        </p>
      </div>
    </div>
  );
}
