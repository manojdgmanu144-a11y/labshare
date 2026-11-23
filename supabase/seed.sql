-- ============================================================
-- LabShare — Seed Data
-- ============================================================
-- BEFORE RUNNING:
--   1. Create two users in Supabase Auth (Authentication > Users):
--        student@demo.edu  /  Demo1234!
--        faculty@demo.edu  /  Demo1234!
--   2. Copy their UUIDs and replace the placeholders below.
--      Search for STUDENT_UUID and FACULTY_UUID.
-- ============================================================

-- Demo user UUIDs (replace with real values from Supabase Auth)
-- STUDENT_UUID = 'aaaaaaaa-0000-0000-0000-000000000001'
-- FACULTY_UUID = 'bbbbbbbb-0000-0000-0000-000000000002'

insert into public.profiles (id, name, role, department) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alex Johnson',    'student', 'Electronics Engineering'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Dr. Priya Sharma', 'faculty', 'Electronics Engineering')
on conflict (id) do update set
  name       = excluded.name,
  role       = excluded.role,
  department = excluded.department;

-- ============================================================
-- Equipment — 20 items across 5 departments
-- ============================================================

insert into public.equipment (name, category, department, location, description, specs, status) values

-- Electronics Engineering (5)
(
  'Raspberry Pi 4 Kit — Set A',
  'Development Kit',
  'Electronics Engineering',
  'EE Lab 101, Bench 3',
  'Complete Raspberry Pi 4 Model B 8 GB starter kit with power supply, micro-SD card, HDMI cable, and GPIO breakout board.',
  '{"cpu":"Broadcom BCM2711 quad-core Cortex-A72 1.8GHz","ram":"8GB LPDDR4","storage":"32GB microSD","gpio":40,"connectivity":"WiFi 5, BT 5.0, Gigabit Ethernet"}',
  'available'
),
(
  'Raspberry Pi 4 Kit — Set B',
  'Development Kit',
  'Electronics Engineering',
  'EE Lab 101, Bench 4',
  'Identical to Set A — provides a second concurrent booking slot.',
  '{"cpu":"Broadcom BCM2711 quad-core Cortex-A72 1.8GHz","ram":"8GB LPDDR4","storage":"32GB microSD","gpio":40,"connectivity":"WiFi 5, BT 5.0, Gigabit Ethernet"}',
  'available'
),
(
  'Arduino Mega 2560 Kit',
  'Development Kit',
  'Electronics Engineering',
  'EE Lab 101, Bench 5',
  'Arduino Mega 2560 Rev3 with sensor pack (DHT22, ultrasonic, IR, soil moisture), breadboard, and jumper wires.',
  '{"microcontroller":"ATmega2560","flash":"256KB","sram":"8KB","digitalPins":54,"analogPins":16,"clockSpeed":"16MHz"}',
  'available'
),
(
  'Rigol DS1054Z Oscilloscope',
  'Test & Measurement',
  'Electronics Engineering',
  'EE Lab 102, Station 1',
  '4-channel digital oscilloscope with 50 MHz bandwidth, 1 GSa/s sample rate, and 12 Mpts memory depth.',
  '{"channels":4,"bandwidth":"50MHz","sampleRate":"1GSa/s","memoryDepth":"12Mpts","display":"7-inch TFT 800x480"}',
  'available'
),
(
  'Xilinx Artix-7 FPGA Board',
  'FPGA',
  'Electronics Engineering',
  'EE Lab 103, Cabinet A',
  'Digilent Nexys A7-100T FPGA development board with onboard DDR2, Ethernet, VGA, USB, and 7-segment displays.',
  '{"fpga":"Xilinx Artix-7 XC7A100T","logicCells":101440,"bram":"4860Kb","dsp":240,"ddr2":"128MB","io":"210 user I/O"}',
  'available'
),

-- Computer Science (4)
(
  'GPU Workstation — CUDA Node 1',
  'Workstation',
  'Computer Science',
  'CS HPC Room 201, Node 1',
  'High-performance GPU workstation for deep learning training. Dual NVIDIA RTX 4090, 128 GB RAM, 4 TB NVMe.',
  '{"gpu":"2× NVIDIA RTX 4090 24GB","cpu":"AMD Threadripper PRO 5975WX 32-core","ram":"128GB DDR5 ECC","storage":"4TB NVMe SSD","os":"Ubuntu 22.04 + CUDA 12.3"}',
  'available'
),
(
  'GPU Workstation — CUDA Node 2',
  'Workstation',
  'Computer Science',
  'CS HPC Room 201, Node 2',
  'Identical spec to CUDA Node 1 — provides a second training slot.',
  '{"gpu":"2× NVIDIA RTX 4090 24GB","cpu":"AMD Threadripper PRO 5975WX 32-core","ram":"128GB DDR5 ECC","storage":"4TB NVMe SSD","os":"Ubuntu 22.04 + CUDA 12.3"}',
  'available'
),
(
  'Jetson Orin NX Developer Kit',
  'Development Kit',
  'Computer Science',
  'CS AI Lab 205, Shelf 2',
  'NVIDIA Jetson Orin NX 16 GB module for edge AI inference and robotics prototyping.',
  '{"ai":"1024-core Ampere GPU + 32 Tensor Cores","cpu":"8-core Arm Cortex-A78AE","ram":"16GB LPDDR5","storage":"64GB eMMC","aiPerf":"100 TOPS"}',
  'available'
),
(
  'Raspberry Pi 5 Cluster (4-node)',
  'Development Kit',
  'Computer Science',
  'CS Networks Lab 207, Rack B',
  'Four Raspberry Pi 5 8 GB boards pre-cabled for distributed computing experiments.',
  '{"nodes":4,"cpuPerNode":"Broadcom BCM2712 quad-core Cortex-A76 2.4GHz","ramPerNode":"8GB LPDDR4X","storagePerNode":"64GB microSD","network":"Gigabit switch included"}',
  'available'
),

-- Mechanical Engineering (4)
(
  'Creality Ender-3 V3 3D Printer',
  '3D Printer',
  'Mechanical Engineering',
  'ME Fabrication Lab 301, Station A',
  'FDM 3D printer with 220×220×250 mm build volume, auto-levelling, and 300 mm/s max print speed.',
  '{"technology":"FDM","buildVolume":"220×220×250mm","nozzleDiameter":"0.4mm","maxSpeed":"300mm/s","materials":"PLA, PETG, TPU","connectivity":"USB, microSD"}',
  'available'
),
(
  'Bambu Lab P1S 3D Printer',
  '3D Printer',
  'Mechanical Engineering',
  'ME Fabrication Lab 301, Station B',
  'High-speed enclosed FDM printer with multi-material unit (AMS) and active temperature control.',
  '{"technology":"FDM","buildVolume":"256×256×256mm","nozzleDiameter":"0.4mm","maxSpeed":"500mm/s","materials":"PLA, ABS, ASA, PA, PC, TPU","ams":"4-colour AMS"}',
  'available'
),
(
  'Digital Callipers & Measurement Set',
  'Measurement',
  'Mechanical Engineering',
  'ME Lab 302, Tool Cabinet',
  'Set of Mitutoyo digital callipers (150 mm, 300 mm), micrometer screw gauges, and depth gauge for precision measurement.',
  '{"callipers":"150mm & 300mm Mitutoyo 500-series","resolution":"0.01mm","micrometer":"0–25mm range 0.001mm resolution"}',
  'available'
),
(
  'Festo Pneumatics Training System',
  'Training System',
  'Mechanical Engineering',
  'ME Controls Lab 305, Bench 2',
  'Industry-standard Festo modular pneumatics trainer covering cylinders, valves, sensors, and PLC interfacing.',
  '{"components":"double-acting cylinders, 5/2 solenoid valves, pressure sensors, PLC interface module","pressure":"max 6 bar","standard":"ISO 15552"}',
  'available'
),

-- Biomedical Engineering (4)
(
  'Arduino Nano BLE Sense Kit',
  'Development Kit',
  'Biomedical Engineering',
  'BME Lab 401, Bench 1',
  'Arduino Nano 33 BLE Sense Rev2 with built-in IMU, microphone, temperature, humidity, pressure, gesture, and colour sensors.',
  '{"microcontroller":"nRF52840 64MHz Cortex-M4","flash":"1MB","ram":"256KB","sensors":"LSM9DS1 IMU, HTS221, LPS22HB, APDS-9960, MP34DT05","wireless":"BLE 5.0"}',
  'available'
),
(
  'Patient Vital-Signs Simulator',
  'Medical Simulation',
  'Biomedical Engineering',
  'BME Lab 402, Station 3',
  'Fluke ProSim 4 vital-signs simulator generating ECG, SpO2, NIBP, temperature, and respiration waveforms for device testing.',
  '{"ecgLeads":"3, 5, 10-lead","heartRateRange":"10–360 bpm","spo2":"85–100%","nibp":"systolic 60–280 mmHg","temperature":"35–42°C","standard":"IEC 60601-1"}',
  'available'
),
(
  'Raspberry Pi Zero 2 W Wearable Kit',
  'Development Kit',
  'Biomedical Engineering',
  'BME Lab 401, Shelf 2',
  'Pi Zero 2 W with MAX30102 pulse-oximeter, DS18B20 temperature sensor, flexible Li-Po battery, and 3D-printed wristband enclosure.',
  '{"cpu":"RP3A0 quad-core Cortex-A53 1GHz","ram":"512MB","wireless":"WiFi 4, BT 4.2","sensors":"MAX30102 SpO2/HR, DS18B20 temperature","battery":"500mAh Li-Po"}',
  'available'
),
(
  'Ultrasound Phantom & Probe Set',
  'Medical Imaging',
  'Biomedical Engineering',
  'BME Imaging Lab 405',
  'CIRS multi-purpose tissue-mimicking ultrasound phantom with 3.5 MHz and 7.5 MHz probes for image quality assessment experiments.',
  '{"phantom":"CIRS 040GSE multi-purpose","frequencies":"3.5MHz, 7.5MHz","features":"cysts, wire targets, grey-scale ramps","compatibility":"standard BNC connectors"}',
  'available'
),

-- Physics (3)
(
  'Optical Breadboard & Laser Kit',
  'Optics',
  'Physics',
  'Physics Lab 501, Optical Table A',
  'Thor Labs 600×900 mm optical breadboard with 532 nm DPSS laser (5 mW), lens mounts, beam splitters, and alignment accessories.',
  '{"breadboard":"600×900mm Thor Labs MB6090/M","laser":"532nm DPSS 5mW Class IIIb","accessories":"mounts, beam splitters, irises, power meter"}',
  'available'
),
(
  'Keithley 2450 Source Measure Unit',
  'Test & Measurement',
  'Physics',
  'Physics Lab 502, Station 2',
  'Precision source-measure unit for I-V characterisation of solar cells, diodes, and nanomaterial devices.',
  '{"voltageRange":"±210V","currentRange":"±1A","resistance":"100μΩ–200MΩ","accuracy":"0.012% basic V accuracy","interface":"GPIB, USB, LAN, TSP-Link"}',
  'available'
),
(
  'Vacuum Chamber & Turbomolecular Pump',
  'Vacuum Systems',
  'Physics',
  'Physics Advanced Lab 505',
  'Pfeiffer HiCube 80 Eco turbomolecular pump station with 10-litre stainless-steel chamber for thin-film and surface-science experiments.',
  '{"ultimatePressure":"5×10⁻⁷ mbar","pumpingSpeed":"67 L/s","chamberVolume":"10L","flanges":"DN100 ISO-K, 4× DN40 ISO-KF","powerSupply":"230V 50Hz"}',
  'available'
);
