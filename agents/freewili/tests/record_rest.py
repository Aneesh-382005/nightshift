"""Record ~3 s of real '*motion' and '*button' frames from the board (board at rest) to tests/rest_sample.json."""
import json, queue, time, onewili
dev = onewili.connect(); t = dev._transport
try:
    print(dev.gui.stream_io(20), dev.io.sensors.enable_motion_stream(10))
    t0 = time.time(); motion = []; buttons = []
    while time.time() - t0 < 3:
        try: f = t.events.get(timeout=0.2)
        except queue.Empty: continue
        if f.path == '*motion': motion.append([round(time.time() - t0, 3)] + [float(x) for x in f.response.split()[:3]])
        elif f.path == '*button': buttons.append([round(time.time() - t0, 3), f.response])
    json.dump({'motion': motion, 'buttons': buttons}, open('tests/rest_sample.json', 'w'))
    print('motion frames', len(motion), 'button frames', len(buttons))
finally:
    dev.gui.stream_io(0); dev.io.sensors.enable_motion_stream(0); dev.close()
