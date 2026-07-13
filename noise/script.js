class NoiseGenerator {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.filterNode = null;
        this.sourceNode = null;
        this.analyser = null;
        this.isPlaying = false;
        this.currentType = 'white';
        this.buffers = {};

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
        if (this.ctx) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        this.masterGain = this.ctx.createGain();
        this.filterNode = this.ctx.createBiquadFilter();
        this.analyser = this.ctx.createAnalyser();

        // Setup graph: Source -> Filter -> MasterGain -> Analyser -> Destination
        this.filterNode.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        // Initial settings
        this.filterNode.type = 'lowpass';
        this.filterNode.frequency.value = 20000;
        this.masterGain.gain.value = 0.5;
        this.analyser.fftSize = 256;

        // Generate buffers
        await this.generateBuffers();
    }

    async generateBuffers() {
        const duration = 30;
        const crossfadeDuration = 2; // 2 seconds crossfade
        const warmupDuration = 2;    // 2 seconds filter warmup
        
        const sampleRate = this.ctx.sampleRate;
        const loopCount = sampleRate * duration;
        const crossfadeCount = sampleRate * crossfadeDuration;
        const warmupCount = sampleRate * warmupDuration;
        const totalCount = loopCount + crossfadeCount;

        // Helper to apply equal-power crossfade to seamless loop
        const applyCrossfade = (data) => {
            const out = new Float32Array(loopCount);
            // Copy the non-overlapping part
            for (let i = crossfadeCount; i < loopCount; i++) {
                out[i] = data[i];
            }
            // Crossfade the overlap region (blend start and end of original sequence)
            for (let i = 0; i < crossfadeCount; i++) {
                const t = i / (crossfadeCount - 1);
                const gainStart = Math.sin(t * Math.PI / 2);
                const gainEnd = Math.cos(t * Math.PI / 2);
                out[i] = data[loopCount + i] * gainEnd + data[i] * gainStart;
            }
            return out;
        };

        // 1. White Noise
        this.buffers.white = this.ctx.createBuffer(1, loopCount, sampleRate);
        const whiteData = this.buffers.white.getChannelData(0);
        const rawWhite = new Float32Array(totalCount);
        for (let i = 0; i < totalCount; i++) {
            rawWhite[i] = Math.random() * 2 - 1;
        }
        whiteData.set(applyCrossfade(rawWhite));

        // 2. Pink Noise (Paul Kellett's refined method with warmup and crossfade)
        this.buffers.pink = this.ctx.createBuffer(1, loopCount, sampleRate);
        const pinkData = this.buffers.pink.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        
        // Warmup filter states
        for (let i = 0; i < warmupCount; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            b6 = white * 0.115926;
        }
        
        // Generate raw pink noise
        const rawPink = new Float32Array(totalCount);
        for (let i = 0; i < totalCount; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            rawPink[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            rawPink[i] *= 0.11; // compensate for gain
            b6 = white * 0.115926;
        }
        pinkData.set(applyCrossfade(rawPink));

        // 3. Brown Noise (with warmup and crossfade)
        this.buffers.brown = this.ctx.createBuffer(1, loopCount, sampleRate);
        const brownData = this.buffers.brown.getChannelData(0);
        let lastOut = 0;
        
        // Warmup filter state
        for (let i = 0; i < warmupCount; i++) {
            const white = Math.random() * 2 - 1;
            lastOut = (lastOut + (0.02 * white)) / 1.02;
        }
        
        // Generate raw brown noise
        const rawBrown = new Float32Array(totalCount);
        for (let i = 0; i < totalCount; i++) {
            const white = Math.random() * 2 - 1;
            lastOut = (lastOut + (0.02 * white)) / 1.02;
            rawBrown[i] = lastOut * 3.5; // compensate for gain
        }
        brownData.set(applyCrossfade(rawBrown));

        // 4. Speech Blocker (pink noise with low-mid emphasis and light air, generated with warmup and crossfade)
        this.buffers.speech_blocker = this.ctx.createBuffer(1, loopCount, sampleRate);
        const speechData = this.buffers.speech_blocker.getChannelData(0);
        
        let sb_b0 = 0, sb_b1 = 0, sb_b2 = 0, sb_b3 = 0, sb_b4 = 0, sb_b5 = 0, sb_b6 = 0;
        let sb_lowMid = 0;
        
        // Warmup speech blocker filters
        for (let i = 0; i < warmupCount; i++) {
            const white = Math.random() * 2 - 1;
            sb_b0 = 0.99886 * sb_b0 + white * 0.0555179;
            sb_b1 = 0.99332 * sb_b1 + white * 0.0750759;
            sb_b2 = 0.96900 * sb_b2 + white * 0.1538520;
            sb_b3 = 0.86650 * sb_b3 + white * 0.3104856;
            sb_b4 = 0.55000 * sb_b4 + white * 0.5329522;
            sb_b5 = -0.7616 * sb_b5 - white * 0.0168980;
            sb_b6 = white * 0.115926;
            
            sb_lowMid = sb_lowMid * 0.985 + white * 0.015;
        }

        // Generate raw speech blocker
        const rawSpeech = new Float32Array(totalCount);
        for (let i = 0; i < totalCount; i++) {
            const white = Math.random() * 2 - 1;
            sb_b0 = 0.99886 * sb_b0 + white * 0.0555179;
            sb_b1 = 0.99332 * sb_b1 + white * 0.0750759;
            sb_b2 = 0.96900 * sb_b2 + white * 0.1538520;
            sb_b3 = 0.86650 * sb_b3 + white * 0.3104856;
            sb_b4 = 0.55000 * sb_b4 + white * 0.5329522;
            sb_b5 = -0.7616 * sb_b5 - white * 0.0168980;
            const pinkVal = (sb_b0 + sb_b1 + sb_b2 + sb_b3 + sb_b4 + sb_b5 + sb_b6 + white * 0.5362) * 0.11;
            sb_b6 = white * 0.115926;

            sb_lowMid = sb_lowMid * 0.985 + white * 0.015;
            rawSpeech[i] = pinkVal * 0.75 + sb_lowMid * 1.4 + white * 0.06;
        }
        speechData.set(applyCrossfade(rawSpeech));
    }

    startNoise() {
        if (!this.ctx) return;
        if (this.sourceNode) {
            this.sourceNode.stop();
        }

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = this.buffers[this.currentType];
        this.sourceNode.loop = true;
        this.sourceNode.connect(this.filterNode);

        // Fade in
        this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
        this.masterGain.gain.linearRampToValueAtTime(this.volumeSlider.value, this.ctx.currentTime + 0.5);

        this.sourceNode.start();
        this.statusIndicator.innerText = "ACTIVE";
        this.statusIndicator.classList.add('active');
        this.isPlaying = true;
        this.updatePlayButton();
        this.drawVisualizer();
    }

    stopNoise() {
        if (this.sourceNode) {
            // Fade out
            this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            setTimeout(() => {
                if (this.sourceNode) {
                    this.sourceNode.stop();
                    this.sourceNode = null;
                }
            }, 500);
        }
        this.statusIndicator.innerText = "OFF";
        this.statusIndicator.classList.remove('active');
        this.isPlaying = false;
        this.updatePlayButton();
    }

    togglePlay() {
        if (!this.ctx) {
            this.initAudio().then(() => this.startNoise());
        } else {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            if (this.isPlaying) {
                this.stopNoise();
            } else {
                this.startNoise();
            }
        }
    }

    changePreset(type) {
        if (this.currentType === type) return;
        this.currentType = type;

        // Update UI
        this.presetBtns.forEach(btn => btn.classList.remove('selected'));
        document.querySelector(`.preset-btn[data-type="${type}"]`).classList.add('selected');

        // Show/Hide customizer (only meaningful for some, but let's show for all for now)
        this.customizerPanel.classList.remove('hidden');

        if (this.isPlaying) {
            // Crossfade to new noise
            const oldSource = this.sourceNode;
            this.masterGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);

            setTimeout(() => {
                oldSource.stop();
                this.startNoise();
            }, 200);
        }
    }

    updateVolume(val) {
        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.1);
        }
    }

    updateFilter(val) {
        if (this.filterNode) {
            this.filterNode.frequency.setTargetAtTime(val, this.ctx.currentTime, 0.1);
        }
    }

    updatePlayButton() {
        if (this.isPlaying) {
            this.playBtn.innerHTML = '<span class="play-icon">⏸</span> Pause';
        } else {
            this.playBtn.innerHTML = '<span class="play-icon">▶</span> Play';
        }
    }

    resizeCanvas() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    drawVisualizer() {
        if (!this.isPlaying) return;

        requestAnimationFrame(() => this.drawVisualizer());

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const barWidth = (this.canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;

            this.canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.4)'; // Simple white visualization
            this.canvasCtx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    initListeners() {
        this.playBtn.addEventListener('click', () => this.togglePlay());

        this.presetBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.currentTarget.dataset.type;
                this.changePreset(type);
            });
        });

        this.volumeSlider.addEventListener('input', (e) => {
            this.updateVolume(e.target.value);
        });

        this.filterSlider.addEventListener('input', (e) => {
            this.updateFilter(e.target.value);
        });

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

        this.modeBtns.forEach(btn => {
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

        this.modeBtns.forEach(btn => btn.classList.toggle('selected', btn.dataset.mode === mode));

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

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    new NoiseGenerator();
    new PomodoroTimer();
});
