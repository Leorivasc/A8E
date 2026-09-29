/* Exercise the private audio divider without opening a host audio device. */
#include "../Pokey.c"

SDL_Window *g_pSdlWindow = NULL;

static int CheckLinkedAudio(unsigned lowChannel, int fast, int slow15)
{
	PokeyState_t state;
	unsigned cycle, lowEdges = 0, highEdges = 0;
	unsigned base = fast ? 1 : (slow15 ? 114 : 28);
	unsigned first = fast ? 68 : 65;
	unsigned period = fast ? 327 : 321;
	unsigned expectedLow[6], i;
	u8 low = 0, high = 0;

	memset(&state, 0, sizeof(state));
	state.skctl = 3;
	state.audctl = (lowChannel == 0 ? 0x10 : 0x08) |
		(fast ? (lowChannel == 0 ? 0x40 : 0x20) : 0) | (slow15 ? 1 : 0);
	state.aChannels[lowChannel].audf = 0x40;
	state.aChannels[lowChannel + 1].audf = 1;
	state.aChannels[lowChannel].audc = 0xaf;
	state.aChannels[lowChannel + 1].audc = 0xaf;
	state.aChannels[lowChannel].counter = first;
	state.aChannels[lowChannel + 1].counter = period;
	PokeyAudio_RecomputeClocks(state.aChannels, state.audctl);

	/* AHRM 5.3: two low pulses per high period, repeated after every reload. */
	for(i = 0; i < 3; i++)
	{
		expectedLow[2 * i] = (i * period + first) * base;
		expectedLow[2 * i + 1] = (i * period + first + 256) * base;
	}
	for(cycle = 1; cycle <= 3 * period * base; cycle++)
	{
		PokeyAudio_StepCpuCycle(&state, state.aChannels, state.audctl);
		if(state.aChannels[lowChannel].output != low)
		{
			if(lowEdges >= 6 || cycle != expectedLow[lowEdges])
			{
				fprintf(stderr, "AUDCTL=%02X unexpected low pulse at %u\n", state.audctl, cycle);
				return 0;
			}
			lowEdges++;
		}
		if(state.aChannels[lowChannel + 1].output != high)
		{
			highEdges++;
			if(cycle != highEdges * period * base) return 0;
		}
		low = state.aChannels[lowChannel].output;
		high = state.aChannels[lowChannel + 1].output;
	}
	return lowEdges == 6 && highEdges == 3;
}

int main(void)
{
	unsigned low;
	int fast, slow15;
	for(low = 0; low <= 2; low += 2)
		for(fast = 0; fast <= 1; fast++)
			for(slow15 = 0; slow15 <= 1; slow15++)
				if(!CheckLinkedAudio(low, fast, slow15)) return 1;
	puts("pokey_linked_audio_probe passed");
	return 0;
}
