class ContinuousNoiseProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();

        this.currentType = options.processorOptions?.type || 'brown';
        this.previousType = null;
        this.transitionLength = Math.max(1, Math.round(sampleRate * 0.16));
        this.transitionRemaining = 0;
        this.states = {
            pink: this.createPinkState(),
            brown: { lastOut: 0 },
            speech_blocker: { ...this.createPinkState(), lowMid: 0 },
        };

        // Start each coloured-noise filter in its normal operating range instead
        // of allowing an audible ramp from silence at the beginning of playback.
        Object.keys(this.states).forEach((type) => {
            for (let i = 0; i < 4096; i++) this.sample(type);
        });

        this.port.onmessage = ({ data }) => {
            if (!data || data.type === this.currentType) return;

            this.previousType = this.currentType;
            this.currentType = data.type;
            this.transitionRemaining = this.transitionLength;
        };
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

    process(_inputs, outputs) {
        const output = outputs[0][0];

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

        return true;
    }
}

registerProcessor('continuous-noise', ContinuousNoiseProcessor);
