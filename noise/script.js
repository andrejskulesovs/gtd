class NoiseSampleGenerator {
    constructor(sampleRate, type) {
        this.currentType = type;
        this.previousType = null;
        this.transitionLength = Math.max(1, Math.round(sampleRate * 0.16));
        this.transitionRemaining = 0;
        this.states = {
            pink: this.createPinkState(),
            brown: { lastOut: 0 },
            speech_blocker: { ...this.createPinkState(), lowMid: 0 },
        };

        Object.keys(this.states).forEach((noiseType) => {
            for (let i = 0; i < 4096; i++) this.sample(noiseType);
        });
    }

    createPinkState() {
        return { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
    }

    pinkSample(state, white) {
        state.b0 = 0.99886 * state.b0 + white * 0.0555179;
        state.b1 = 0.99332 * state.b1 + white * 0.0750759;
        state.b2 = 0.969 * state.b2 + white * 0.153852;
        state.b3 = 0.8665 * state.b3 + white * 0.3104856;
        state.b4 = 0.55 * state.b4 + white * 0.5329522;
        state.b5 = -0.7616 * state.b5 - white * 0.016898;

        const output = (state.b0 + state.b1 + state.b2 + state.b3 + state.b4 + state.b5 + state.b6 + white * 0.5362) * 0.11;
        state.b6 = white * 0.115926;
        return output;
    }

    sample(type) {
        const white = Math.random() * 2 - 1;

        switch (type) {
            case 'pink':
                return this.pinkSample(this.states.pink, white);
            case 'brown': {
                const state = this.states.brown;
                state.lastOut = (state.lastOut + white * 0.02) / 1.02;
                return state.lastOut * 3.5;
            }
            case 'speech_blocker': {
                const state = this.states.speech_blocker;
                const pink = this.pinkSample(state, white);
                state.lowMid = state.lowMid * 0.985 + white * 0.015;
                return pink * 0.75 + state.lowMid * 1.4 + white * 0.06;
            }
            case 'white':
            default:
                return white;
        }
    }

    setType(type) {
        if (type === this.currentType) return;

        this.previousType = this.currentType;
        this.currentType = type;
        this.transitionRemaining = this.transitionLength;
    }

    fill(output) {
        for (let i = 0; i < output.length; i++) {
            const current = this.sample(this.currentType);

            if (this.transitionRemaining > 0) {
                const previous = this.sample(this.previousType);
                const progress = 1 - this.transitionRemaining / this.transitionLength;
                output[i] = previous * Math.cos(progress * Math.PI / 2) + current * Math.sin(progress * Math.PI / 2);
                this.transitionRemaining--;

                if (this.transitionRemaining === 0) this.previousType = null;
            } else {
                output[i] = current;
            }
        }
    }
}

class NoiseGenerator {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.filterNode = null;
        this.limiter = null;
        this.sourceNode = null;
        this.analyser = null;
        this.visualizerData = null;
        this.visualizerFrame = null;
        this.stopTimer = null;
        this.initPromise = null;
        this.audioReady = false;
        this.usesAudioWorklet = false;
        this.isPlaying = false;
        this.currentType = 'white';

        // UI Elements
        this.playBtn = document.getElementById('play-pause');
        this.volumeSlider = document.getElementById('volume');
        this.filterSlider = document.getElementById('low-pass');
        this.presetBtns = document.querySelectorAll('.preset-btn');
        this.canvas = document.getElementById('visualizer');
        this.canvasCtx = this.canvas.getContext('2d');
        this.statusIndicator = document.getElementById('status-indicator');
        this.customizerPanel = document.getElementById('customizer-panel');

        this.initListeners();
        requestAnimationFrame(() => this.resizeCanvas());
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    async initAudio() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();

            this.masterGain = this.ctx.createGain();
            this.filterNode = this.ctx.createBiquadFilter();
            this.limiter = this.ctx.createDynamicsCompressor();
            this.analyser = this.ctx.createAnalyser();

            // Source -> tone shaping -> peak protection -> volume -> visualizer.
            // The limiter prevents the occasional noise peak from clipping when
            // a preset and the volume slider are both set high.
            this.filterNode.connect(this.limiter);
            this.limiter.connect(this.masterGain);
            this.masterGain.connect(this.analyser);
            this.analyser.connect(this.ctx.destination);

            this.filterNode.type = 'lowpass';
            this.filterNode.frequency.value = Number(this.filterSlider.value);
            this.filterNode.Q.value = Math.SQRT1_2;
            this.masterGain.gain.value = 0;
            this.limiter.threshold.value = -9;
            this.limiter.knee.value = 0;
            this.limiter.ratio.value = 20;
            this.limiter.attack.value = 0.003;
            this.limiter.release.value = 0.12;
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.85;
            this.visualizerData = new Uint8Array(this.analyser.frequencyBinCount);

            try {
                if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
                    throw new Error('AudioWorklet is unavailable');
                }
                await this.ctx.audioWorklet.addModule('noise-processor.js');
                this.usesAudioWorklet = true;
            } catch (error) {
                // Older browsers use the fallback below. Modern browsers keep
                // the generator on the audio rendering thread, which is the
                // important path for uninterrupted long-running playback.
                this.usesAudioWorklet = false;
                console.info('Using compatibility noise generator.', error);
            }

            this.audioReady = true;
        })();

        try {
            await this.initPromise;
        } catch (error) {
            this.initPromise = null;
            this.ctx = null;
            throw error;
        }

        return this.initPromise;
    }

    createNoiseSource() {
        if (this.usesAudioWorklet) {
            return new AudioWorkletNode(this.ctx, 'continuous-noise', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                processorOptions: { type: this.currentType },
            });
        }

        // A compatibility fallback for browsers without AudioWorklet support.
        // It has no finite buffer, so it still cannot create a loop seam.
        const generator = new NoiseSampleGenerator(this.ctx.sampleRate, this.currentType);
        const source = this.ctx.createScriptProcessor(4096, 0, 1);
        source.onaudioprocess = (event) => generator.fill(event.outputBuffer.getChannelData(0));
        source.setNoiseType = (type) => generator.setType(type);
        return source;
    }

    disposeSource(source) {
        if (!source) return;

        source.disconnect();
        if ('onaudioprocess' in source) source.onaudioprocess = null;
    }

    startNoise() {
        if (!this.audioReady || !this.ctx) return;

        window.clearTimeout(this.stopTimer);
        if (this.sourceNode) this.disposeSource(this.sourceNode);

        this.sourceNode = this.createNoiseSource();
        this.sourceNode.connect(this.filterNode);

        const now = this.ctx.currentTime;
        const targetVolume = Number(this.volumeSlider.value);
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(0, now);
        this.masterGain.gain.linearRampToValueAtTime(targetVolume, now + 0.08);

        this.statusIndicator.innerText = 'ACTIVE';
        this.statusIndicator.classList.add('active');
        this.isPlaying = true;
        this.updatePlayButton();

        if (this.visualizerFrame === null) this.drawVisualizer();
    }

    stopNoise() {
        if (this.sourceNode) {
            const sourceToStop = this.sourceNode;
            const now = this.ctx.currentTime;
            this.masterGain.gain.cancelScheduledValues(now);
            this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
            this.masterGain.gain.linearRampToValueAtTime(0, now + 0.12);

            this.stopTimer = window.setTimeout(() => {
                if (this.sourceNode !== sourceToStop) return;
                this.disposeSource(sourceToStop);
                this.sourceNode = null;
            }, 140);
        }

        this.statusIndicator.innerText = 'OFF';
        this.statusIndicator.classList.remove('active');
        this.isPlaying = false;
        this.updatePlayButton();

        if (this.visualizerFrame !== null) {
            cancelAnimationFrame(this.visualizerFrame);
            this.visualizerFrame = null;
        }
    }

    async togglePlay() {
        if (!this.audioReady) {
            this.playBtn.disabled = true;
            try {
                await this.initAudio();
                await this.ctx.resume();
                this.startNoise();
            } finally {
                this.playBtn.disabled = false;
            }
            return;
        }

        if (this.isPlaying) {
            this.stopNoise();
            return;
        }

        if (this.ctx.state === 'suspended') await this.ctx.resume();
        this.startNoise();
    }

    changePreset(type) {
        if (this.currentType === type) return;
        this.currentType = type;

        this.presetBtns.forEach((btn) => btn.classList.toggle('selected', btn.dataset.type === type));
        this.customizerPanel.classList.remove('hidden');

        if (!this.isPlaying || !this.sourceNode) return;

        // Change colour inside the generator. It performs an equal-power
        // crossfade there, so the master output never drops to silence.
        if (this.usesAudioWorklet) {
            this.sourceNode.port.postMessage({ type });
        } else {
            this.sourceNode.setNoiseType(type);
        }
    }

    updateVolume(val) {
        if (!this.masterGain) return;
        this.masterGain.gain.setTargetAtTime(Number(val), this.ctx.currentTime, 0.025);
    }

    updateFilter(val) {
        if (!this.filterNode) return;
        this.filterNode.frequency.setTargetAtTime(Number(val), this.ctx.currentTime, 0.04);
    }

    updatePlayButton() {
        this.playBtn.innerHTML = this.isPlaying
            ? '<span class="play-icon">⏸</span> Pause'
            : '<span class="play-icon">▶</span> Play';
    }

    resizeCanvas() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    drawVisualizer() {
        if (!this.isPlaying) {
            this.visualizerFrame = null;
            return;
        }

        this.analyser.getByteFrequencyData(this.visualizerData);
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const barWidth = (this.canvas.width / this.visualizerData.length) * 2.5;
        let x = 0;

        for (let i = 0; i < this.visualizerData.length; i++) {
            const barHeight = this.visualizerData[i] / 2;
            this.canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            this.canvasCtx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }

        this.visualizerFrame = requestAnimationFrame(() => this.drawVisualizer());
    }

    initListeners() {
        this.playBtn.addEventListener('click', () => this.togglePlay());

        this.presetBtns.forEach((btn) => {
            btn.addEventListener('click', (event) => this.changePreset(event.currentTarget.dataset.type));
        });

        this.volumeSlider.addEventListener('input', (event) => this.updateVolume(event.target.value));
        this.filterSlider.addEventListener('input', (event) => this.updateFilter(event.target.value));

        this.changePreset('brown');
    }
}

class BrowserTabState {
    constructor() {
        this.iconLink = document.getElementById('app-icon') || this.createIconLink();
    }

    createIconLink() {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.id = 'app-icon';
        document.head.appendChild(link);
        return link;
    }

    update({ mode, remaining, running, completed }) {
        const time = this.formatTime(remaining);
        const label = this.formatMode(mode);
        const prefix = completed ? 'Done' : running ? time : `Paused ${time}`;

        document.title = `${prefix} - ${label}`;
        this.iconLink.href = this.buildIconHref({ mode, running, completed });
    }

    formatTime(remaining) {
        const m = Math.floor(remaining / 60).toString().padStart(2, '0');
        const s = (remaining % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    formatMode(mode) {
        const labels = {
            focus: 'Focus',
            short: 'Short Break',
            long: 'Long Break',
        };
        return labels[mode] || 'Focus';
    }

    buildIconHref({ running, completed }) {
        const statePath = completed
            ? '<path d="M20 16.5l7 7L42 8.5" fill="none" stroke="black" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
            : running
                ? '<path d="M22 17l16 15-16 15z" fill="black"/>'
                : '<path d="M20 17h7v30h-7zM35 17h7v30h-7z" fill="black"/>';
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
                <rect width="64" height="64" rx="16" fill="black"/>
                <circle cx="32" cy="32" r="24" fill="white"/>
                ${statePath}
            </svg>
        `;

        return `data:image/svg+xml,${encodeURIComponent(svg)}`;
    }
}

class PomodoroTimer {
    constructor() {
        this.DURATIONS = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
        this.mode = 'focus';
        this.remaining = this.DURATIONS.focus;
        this.running = false;
        this.intervalId = null;
        this.completed = false;
        this.tabState = new BrowserTabState();

        this.display = document.getElementById('timer-display');
        this.toggleBtn = document.getElementById('timer-toggle');
        this.modeBtns = document.querySelectorAll('.mode-btn');
        this.nextActions = document.getElementById('timer-next-actions');

        this.initListeners();
        this.render();
    }

    initListeners() {
        this.toggleBtn.addEventListener('click', () => this.toggle());

        this.modeBtns.forEach((btn) => {
            btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
        });

        document.getElementById('action-short').addEventListener('click', () => this.setMode('short', true));
        document.getElementById('action-long').addEventListener('click', () => this.setMode('long', true));
        document.getElementById('action-focus').addEventListener('click', () => this.setMode('focus', true));
    }

    setMode(mode, autoStart = false) {
        this.stop();
        this.mode = mode;
        this.remaining = this.DURATIONS[mode];
        this.completed = false;
        this.nextActions.classList.add('hidden');

        this.modeBtns.forEach((btn) => btn.classList.toggle('selected', btn.dataset.mode === mode));

        this.render();
        if (autoStart) this.start();
    }

    toggle() {
        this.running ? this.stop() : this.start();
    }

    start() {
        if (this.remaining <= 0) {
            this.remaining = this.DURATIONS[this.mode];
            this.nextActions.classList.add('hidden');
        }
        this.completed = false;
        this.requestNotificationPermission();
        this.running = true;
        this.toggleBtn.textContent = 'Pause';
        this.render();
        this.intervalId = setInterval(() => this.tick(), 1000);
    }

    stop() {
        this.running = false;
        this.toggleBtn.textContent = 'Start';
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.render();
    }

    tick() {
        this.remaining--;
        this.render();
        if (this.remaining <= 0) {
            this.stop();
            this.completed = true;
            this.render();
            this.playNotification();
            this.showSystemNotification();
            this.nextActions.classList.remove('hidden');
        }
    }

    render() {
        const m = Math.floor(this.remaining / 60).toString().padStart(2, '0');
        const s = (this.remaining % 60).toString().padStart(2, '0');
        this.display.textContent = `${m}:${s}`;
        this.tabState.update({
            mode: this.mode,
            remaining: this.remaining,
            running: this.running,
            completed: this.completed,
        });
    }

    playNotification() {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [660, 880, 1100];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.35;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.4, t + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
            osc.start(t);
            osc.stop(t + 0.6);
        });
    }

    requestNotificationPermission() {
        if (!('Notification' in window) || Notification.permission !== 'default') return;
        Notification.requestPermission();
    }

    showSystemNotification() {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        const title = this.mode === 'focus' ? 'Focus session complete' : 'Break complete';
        const body = this.mode === 'focus'
            ? 'Time to take a short break.'
            : 'Ready for the next focus session.';

        new Notification(title, { body });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new NoiseGenerator();
    new PomodoroTimer();
});
