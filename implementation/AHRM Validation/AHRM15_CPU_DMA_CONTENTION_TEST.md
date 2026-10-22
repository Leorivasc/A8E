# AHRM-15 CPU DMA Contention Test

`AHRM15_CPU_DMA_CONTENTION_TEST.XEX` counts iterations of the same tight loop
over fixed 16-frame phases. The DLI changes `DMACTL` between:

`$20` (display-list DMA only), `$22` (normal playfield), `$2E` (normal
playfield plus two-line PMG), `$3E` (normal playfield plus one-line PMG), and
`$2F` (wide playfield plus one-line PMG).

## Expected output

After the phases complete, the screen shows one hexadecimal iteration count
for each DMA configuration. The count should decrease as ANTIC and PMG steal
more bus cycles from the CPU. Exact counts depend on PAL/NTSC timing and the
polling boundary, so compare relative ordering and repeated-target values:

```text
$20 > $22 > $2E/$3E/$2F   (normally)
```

The program restores `DMACTL=$22` before displaying the final result. It does
not print a universal `PASS`; it is a contention observation that complements
the native and JavaScript cycle probes.
