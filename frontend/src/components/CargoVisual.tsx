type CargoVisualProps = {
  className?: string;
};

export function CargoVisual({ className }: CargoVisualProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 800 900"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Animated cargo ship sailing"
    >
      <defs>
        <linearGradient id="cv-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a86ff" />
          <stop offset="55%" stopColor="#2366ea" />
          <stop offset="100%" stopColor="#1b54cf" />
        </linearGradient>
        <radialGradient id="cv-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cv-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f2f5e" />
          <stop offset="100%" stopColor="#0c163a" />
        </linearGradient>
        <linearGradient id="cv-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5c97f5" />
          <stop offset="60%" stopColor="#2f70e4" />
          <stop offset="100%" stopColor="#1b54cf" />
        </linearGradient>
        <radialGradient id="cv-cloud" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dde9ff" />
        </radialGradient>
        <linearGradient id="cv-hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5fc06f" />
          <stop offset="100%" stopColor="#2f8d44" />
        </linearGradient>
        <linearGradient id="cv-pin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffb05a" />
          <stop offset="100%" stopColor="#ef7a1f" />
        </linearGradient>
        <linearGradient id="cv-pin-shine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cv-smoke" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id="cv-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id="cv-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <clipPath id="cv-water-clip">
          <rect x="0" y="640" width="800" height="260" />
        </clipPath>
        <path id="cv-plane-path" d="M260 410 Q360 300 460 340 Q540 370 580 300" fill="none" />
      </defs>

      <rect width="800" height="900" fill="url(#cv-sky)" />

      <g>
        <ellipse cx="600" cy="220" rx="220" ry="180" fill="url(#cv-sun)" />
        <animate
          attributeName="opacity"
          values="0.85;1;0.85"
          dur="6s"
          repeatCount="indefinite"
        />
      </g>

      <g fill="#ffffff" opacity="0.85">
        <circle cx="120" cy="80" r="1.4">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="2.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="220" cy="140" r="1.1">
          <animate attributeName="opacity" values="0.3;0.9;0.3" dur="3.4s" repeatCount="indefinite" begin="0.4s" />
        </circle>
        <circle cx="700" cy="60" r="1.6">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="2.8s" repeatCount="indefinite" begin="0.8s" />
        </circle>
        <circle cx="540" cy="120" r="1.2">
          <animate attributeName="opacity" values="0.3;0.85;0.3" dur="3.2s" repeatCount="indefinite" begin="1.2s" />
        </circle>
        <circle cx="80" cy="200" r="1.1">
          <animate attributeName="opacity" values="0.2;0.9;0.2" dur="3s" repeatCount="indefinite" begin="0.6s" />
        </circle>
        <circle cx="370" cy="50" r="1.3">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="2.4s" repeatCount="indefinite" begin="1.6s" />
        </circle>
      </g>

      <g opacity="0.45" fill="#3f7df0">
        <rect x="600" y="430" width="40" height="220" rx="3" />
        <rect x="650" y="370" width="60" height="280" rx="4" />
        <polygon points="680,370 710,370 695,355" fill="#3f7df0" />
        <rect x="720" y="450" width="35" height="200" rx="3" />
        <rect x="555" y="470" width="35" height="180" rx="3" />
        <rect x="510" y="495" width="30" height="155" rx="3" />
      </g>
      <g fill="#6ea2f7" opacity="0.85">
        <rect x="608" y="450" width="6" height="10" rx="1" />
        <rect x="620" y="450" width="6" height="10" rx="1" />
        <rect x="608" y="475" width="6" height="10" rx="1" />
        <rect x="620" y="475" width="6" height="10" rx="1" />
        <rect x="608" y="500" width="6" height="10" rx="1" />
        <rect x="620" y="500" width="6" height="10" rx="1" />
        <rect x="660" y="395" width="7" height="12" rx="1" />
        <rect x="678" y="395" width="7" height="12" rx="1" />
        <rect x="696" y="395" width="7" height="12" rx="1" />
        <rect x="660" y="425" width="7" height="12" rx="1" />
        <rect x="678" y="425" width="7" height="12" rx="1" />
        <rect x="696" y="425" width="7" height="12" rx="1" />
        <rect x="660" y="455" width="7" height="12" rx="1" />
        <rect x="678" y="455" width="7" height="12" rx="1" />
        <rect x="696" y="455" width="7" height="12" rx="1" />
        <rect x="725" y="475" width="6" height="10" rx="1" />
        <rect x="737" y="475" width="6" height="10" rx="1" />
        <rect x="725" y="500" width="6" height="10" rx="1" />
        <rect x="737" y="500" width="6" height="10" rx="1" />
        <rect x="520" y="515" width="5" height="9" rx="1" />
        <rect x="530" y="515" width="5" height="9" rx="1" />
      </g>
      <g fill="#ffe9a8" opacity="0.55">
        <rect x="612" y="555" width="4" height="6" />
        <rect x="624" y="555" width="4" height="6" />
        <rect x="664" y="540" width="5" height="7" />
        <rect x="682" y="540" width="5" height="7" />
        <rect x="700" y="540" width="5" height="7" />
        <rect x="728" y="555" width="4" height="6" />
      </g>

      <g opacity="0.55">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="-40 0; 60 0; -40 0"
          dur="34s"
          repeatCount="indefinite"
        />
        <path
          d="M40 250 Q70 210 130 220 Q160 190 220 210 Q280 200 300 240 Q330 270 280 290 L80 290 Q20 290 40 250 Z"
          fill="url(#cv-cloud)"
          filter="url(#cv-soft)"
        />
        <path
          d="M540 160 Q570 130 620 140 Q660 120 700 145 Q740 145 745 180 Q760 215 700 220 L560 220 Q510 215 540 160 Z"
          fill="url(#cv-cloud)"
          opacity="0.8"
          filter="url(#cv-soft)"
        />
      </g>

      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; 22 0; 0 0"
          dur="22s"
          repeatCount="indefinite"
        />
        <path
          d="M110 430 Q140 350 230 360 Q270 295 350 325 Q410 270 480 315 Q550 280 605 340 Q685 335 705 410 Q735 475 670 515 L150 515 Q70 505 110 430 Z"
          fill="url(#cv-cloud)"
        />
        <path
          d="M240 480 Q265 425 320 430 Q355 395 405 415 Q455 390 500 425 Q545 425 560 465 Q575 510 520 525 L285 525 Q225 520 240 480 Z"
          fill="#ffffff"
          opacity="0.92"
        />
        <ellipse cx="350" cy="430" rx="120" ry="14" fill="#ffffff" opacity="0.35" filter="url(#cv-soft)" />
      </g>

      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="540 232; 540 218; 540 232"
          dur="2.6s"
          repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
          keyTimes="0;0.5;1"
        />
        <ellipse cx="0" cy="78" rx="32" ry="6" fill="#000000" opacity="0.18" filter="url(#cv-soft)">
          <animate
            attributeName="rx"
            values="32;26;32"
            dur="2.6s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.18;0.28;0.18"
            dur="2.6s"
            repeatCount="indefinite"
          />
        </ellipse>
        <g filter="url(#cv-glow)" opacity="0.55">
          <circle r="42" fill="#ffb05a" />
        </g>
        <path
          d="M0 0 C0 -40 32 -68 64 -68 C96 -68 128 -40 128 0 C128 38 64 96 64 96 C64 96 0 38 0 0 Z"
          transform="translate(-64,-32)"
          fill="url(#cv-pin)"
        />
        <path
          d="M-40 -50 C-30 -64 -10 -68 4 -64"
          stroke="url(#cv-pin-shine)"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          opacity="0.75"
        />
        <circle r="22" fill="#ffffff" />
        <circle r="10" fill="#ef7a1f" opacity="0.85" />
      </g>

      <g stroke="#ffe2b8" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.85">
        <path d="M250 410 Q330 320 430 345 Q500 365 555 320" strokeDasharray="2 11">
          <animate attributeName="stroke-dashoffset" values="0;-52" dur="2.4s" repeatCount="indefinite" />
        </path>
      </g>

      <g>
        <animateMotion
          dur="9s"
          repeatCount="indefinite"
          rotate="auto"
          path="M250 410 Q330 320 430 345 Q500 365 555 320 Q500 365 430 345 Q330 320 250 410"
        />
        <g>
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="-4;6;-4"
            dur="1.6s"
            repeatCount="indefinite"
          />
          <polygon points="0,0 50,-9 16,8" fill="#ff8a2b" />
          <polygon points="0,0 50,-9 24,-2" fill="#e76b16" />
          <polygon points="16,8 24,-2 50,-9" fill="#ffc789" />
          <polygon points="0,0 16,8 6,4" fill="#c9540f" />
        </g>
      </g>

      <g opacity="0.85">
        <g transform="translate(380 405)">
          <animateTransform
            attributeName="transform"
            type="translate"
            values="380 410; 380 380; 380 410"
            dur="3.4s"
            repeatCount="indefinite"
          />
          <path d="M0 0 q-6 -6 -12 0 q-6 0 -8 6 q-2 6 6 6 q6 6 12 0 q8 0 6 -6 q-2 -6 -4 -6 z" fill="#ffffff" opacity="0.9">
            <animate attributeName="opacity" values="0;0.9;0" dur="3.4s" repeatCount="indefinite" />
          </path>
        </g>
        <g transform="translate(380 395)">
          <animateTransform
            attributeName="transform"
            type="translate"
            values="384 395; 384 355; 384 395"
            dur="3.4s"
            repeatCount="indefinite"
            begin="1.1s"
          />
          <path d="M0 0 q-5 -5 -10 0 q-5 0 -6 5 q-1 5 5 5 q5 5 10 0 q6 0 5 -5 q-1 -5 -4 -5 z" fill="#ffffff" opacity="0.7">
            <animate attributeName="opacity" values="0;0.7;0" dur="3.4s" repeatCount="indefinite" begin="1.1s" />
          </path>
        </g>
        <g transform="translate(384 388)">
          <animateTransform
            attributeName="transform"
            type="translate"
            values="388 388; 388 340; 388 388"
            dur="3.4s"
            repeatCount="indefinite"
            begin="2.2s"
          />
          <path d="M0 0 q-4 -4 -8 0 q-4 0 -5 4 q-1 4 4 4 q4 4 8 0 q5 0 4 -4 q-1 -4 -3 -4 z" fill="#ffffff" opacity="0.5">
            <animate attributeName="opacity" values="0;0.5;0" dur="3.4s" repeatCount="indefinite" begin="2.2s" />
          </path>
        </g>
      </g>

      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; 0 -7; 0 3; 0 0"
          dur="5.2s"
          repeatCount="indefinite"
          calcMode="spline"
          keyTimes="0;0.35;0.75;1"
          keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"
        />
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="-1.4 320 540; 1.4 320 540; -1.4 320 540"
          dur="5.2s"
          repeatCount="indefinite"
          additive="sum"
        />

        <g transform="translate(385 470)">
          <rect x="-3" y="-72" width="6" height="80" fill="#1b2a55" rx="2" />
          <g stroke="#1b2a55" strokeWidth="1.6" opacity="0.9">
            <line x1="0" y1="-70" x2="-28" y2="-18" />
            <line x1="0" y1="-70" x2="28" y2="-18" />
            <line x1="0" y1="-50" x2="-20" y2="-12" />
            <line x1="0" y1="-50" x2="20" y2="-12" />
            <line x1="0" y1="-30" x2="-12" y2="-8" />
            <line x1="0" y1="-30" x2="12" y2="-8" />
          </g>
          <circle cx="0" cy="-76" r="3.4" fill="#ff8a2b">
            <animate attributeName="opacity" values="0.5;1;0.5" dur="1.6s" repeatCount="indefinite" />
          </circle>
        </g>

        <g transform="translate(245 478)">
          <rect x="0" y="-26" width="22" height="34" fill="#f5f7fc" rx="1" />
          <rect x="22" y="-50" width="22" height="58" fill="#f5f7fc" rx="1" />
          <rect x="26" y="-44" width="14" height="22" fill="#1b2a55" opacity="0.55" />
          <rect x="26" y="-66" width="14" height="16" fill="#d75a3a" rx="1" />
          <rect x="30" y="-74" width="6" height="10" fill="#1b2a55" />
          <rect x="2" y="-22" width="6" height="6" fill="#ffe9a8" opacity="0.85" />
          <rect x="12" y="-22" width="6" height="6" fill="#ffe9a8" opacity="0.85" />
        </g>

        <g>
          <rect x="195" y="476" width="32" height="46" fill="#e0653f" rx="2" />
          <rect x="227" y="476" width="32" height="46" fill="#3a7fdc" rx="2" />
          <rect x="259" y="476" width="32" height="46" fill="#f0f2f8" rx="2" />
          <rect x="291" y="476" width="32" height="46" fill="#d44a4a" rx="2" />
          <rect x="323" y="476" width="32" height="46" fill="#3a7fdc" rx="2" />
          <rect x="355" y="476" width="32" height="46" fill="#5cb85c" rx="2" />
          <rect x="387" y="476" width="32" height="46" fill="#e0653f" rx="2" />
          <rect x="419" y="476" width="32" height="46" fill="#f0f2f8" rx="2" />

          <rect x="215" y="430" width="32" height="46" fill="#3a7fdc" rx="2" />
          <rect x="247" y="430" width="32" height="46" fill="#e0653f" rx="2" />
          <rect x="279" y="430" width="32" height="46" fill="#f0f2f8" rx="2" />
          <rect x="311" y="430" width="32" height="46" fill="#5cb85c" rx="2" />
          <rect x="343" y="430" width="32" height="46" fill="#d44a4a" rx="2" />
          <rect x="375" y="430" width="32" height="46" fill="#3a7fdc" rx="2" />
          <rect x="407" y="430" width="32" height="46" fill="#e0653f" rx="2" />

          <g stroke="rgba(0,0,0,0.18)" strokeWidth="1" fill="none">
            <line x1="195" y1="500" x2="451" y2="500" />
            <line x1="215" y1="454" x2="439" y2="454" />
          </g>
          <g fill="#ffffff" opacity="0.18">
            <rect x="197" y="478" width="28" height="2" />
            <rect x="229" y="478" width="28" height="2" />
            <rect x="261" y="478" width="28" height="2" />
            <rect x="293" y="478" width="28" height="2" />
            <rect x="325" y="478" width="28" height="2" />
            <rect x="357" y="478" width="28" height="2" />
            <rect x="389" y="478" width="28" height="2" />
            <rect x="421" y="478" width="28" height="2" />
          </g>
        </g>

        <path d="M170 522 L490 522 L460 584 L210 584 Z" fill="url(#cv-hull)" />
        <path d="M170 522 L490 522 L484 540 L176 540 Z" fill="#d75a3a" />
        <g fill="#ffffff" opacity="0.22">
          <circle cx="220" cy="562" r="4" />
          <circle cx="260" cy="562" r="4" />
          <circle cx="300" cy="562" r="4" />
          <circle cx="340" cy="562" r="4" />
          <circle cx="380" cy="562" r="4" />
          <circle cx="420" cy="562" r="4" />
        </g>
        <path d="M210 584 L220 600 L440 600 L460 584 Z" fill="#0c163a" opacity="0.7" />
      </g>

      <g clipPath="url(#cv-water-clip)">
        <rect x="0" y="640" width="800" height="260" fill="url(#cv-water)" />

        <g opacity="0.32">
          <g transform="translate(170 642) scale(1 -0.45)">
            <path d="M0 0 L320 0 L290 60 L40 60 Z" fill="#0c163a" filter="url(#cv-soft)">
              <animate
                attributeName="opacity"
                values="0.55;0.3;0.55"
                dur="4.6s"
                repeatCount="indefinite"
              />
            </path>
          </g>
        </g>

        <g stroke="#ffffff" fill="none" strokeLinecap="round">
          <path
            d="M-100 678 Q-50 666 0 678 T100 678 T200 678 T300 678 T400 678 T500 678 T600 678 T700 678 T800 678 T900 678"
            strokeWidth="3"
            opacity="0.6"
          >
            <animate
              attributeName="d"
              values="M-100 678 Q-50 666 0 678 T100 678 T200 678 T300 678 T400 678 T500 678 T600 678 T700 678 T800 678 T900 678;
                      M-100 678 Q-50 690 0 678 T100 678 T200 678 T300 678 T400 678 T500 678 T600 678 T700 678 T800 678 T900 678;
                      M-100 678 Q-50 666 0 678 T100 678 T200 678 T300 678 T400 678 T500 678 T600 678 T700 678 T800 678 T900 678"
              dur="4.4s"
              repeatCount="indefinite"
            />
          </path>
          <path
            d="M-100 712 Q-40 698 20 712 T140 712 T260 712 T380 712 T500 712 T620 712 T740 712 T860 712"
            strokeWidth="2.4"
            opacity="0.45"
          >
            <animate
              attributeName="d"
              values="M-100 712 Q-40 698 20 712 T140 712 T260 712 T380 712 T500 712 T620 712 T740 712 T860 712;
                      M-100 712 Q-40 726 20 712 T140 712 T260 712 T380 712 T500 712 T620 712 T740 712 T860 712;
                      M-100 712 Q-40 698 20 712 T140 712 T260 712 T380 712 T500 712 T620 712 T740 712 T860 712"
              dur="5.2s"
              repeatCount="indefinite"
            />
          </path>
          <path
            d="M-100 752 Q-30 740 40 752 T180 752 T320 752 T460 752 T600 752 T740 752 T880 752"
            strokeWidth="2"
            opacity="0.3"
          >
            <animate
              attributeName="d"
              values="M-100 752 Q-30 740 40 752 T180 752 T320 752 T460 752 T600 752 T740 752 T880 752;
                      M-100 752 Q-30 764 40 752 T180 752 T320 752 T460 752 T600 752 T740 752 T880 752;
                      M-100 752 Q-30 740 40 752 T180 752 T320 752 T460 752 T600 752 T740 752 T880 752"
              dur="6s"
              repeatCount="indefinite"
            />
          </path>
        </g>

        <g fill="#ffffff">
          <circle cx="140" cy="690" r="1.4" opacity="0.7">
            <animate attributeName="opacity" values="0;0.9;0" dur="3.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="520" cy="700" r="1.6" opacity="0.6">
            <animate attributeName="opacity" values="0;0.8;0" dur="2.8s" repeatCount="indefinite" begin="0.6s" />
          </circle>
          <circle cx="640" cy="720" r="1.2" opacity="0.7">
            <animate attributeName="opacity" values="0;0.9;0" dur="3.6s" repeatCount="indefinite" begin="1.4s" />
          </circle>
          <circle cx="80" cy="740" r="1.4" opacity="0.65">
            <animate attributeName="opacity" values="0;0.85;0" dur="3s" repeatCount="indefinite" begin="0.9s" />
          </circle>
          <circle cx="700" cy="760" r="1.3" opacity="0.6">
            <animate attributeName="opacity" values="0;0.8;0" dur="3.4s" repeatCount="indefinite" begin="1.8s" />
          </circle>
        </g>
      </g>

      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; 0 -4; 0 0"
          dur="5.2s"
          repeatCount="indefinite"
        />
        <path
          d="M140 642 Q300 614 470 642 L488 666 L122 666 Z"
          fill="#ffffff"
          opacity="0.6"
        />
        <path
          d="M170 654 Q300 638 450 654 L466 666 L154 666 Z"
          fill="#ffffff"
          opacity="0.35"
        />
      </g>

      <g>
        <path d="M690 660 Q730 596 800 608 L800 660 Z" fill="url(#cv-hill)" />
        <path d="M712 660 Q748 624 800 632 L800 660 Z" fill="#2f8d44" opacity="0.85" />
        <g fill="#1f6f36" opacity="0.5">
          <circle cx="740" cy="640" r="6" />
          <circle cx="760" cy="630" r="5" />
          <circle cx="780" cy="636" r="6" />
        </g>
      </g>

      <g fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.85">
        <path d="M0 0 q5 -5 10 0 q5 -5 10 0">
          <animateMotion
            dur="14s"
            repeatCount="indefinite"
            path="M-40 180 Q200 120 400 200 Q600 260 860 160"
          />
          <animate attributeName="opacity" values="0;0.9;0.9;0" dur="14s" repeatCount="indefinite" />
        </path>
        <path d="M0 0 q4 -4 8 0 q4 -4 8 0" opacity="0.7">
          <animateMotion
            dur="18s"
            repeatCount="indefinite"
            begin="3s"
            path="M-40 260 Q220 200 460 280 Q640 320 860 240"
          />
          <animate attributeName="opacity" values="0;0.7;0.7;0" dur="18s" repeatCount="indefinite" begin="3s" />
        </path>
      </g>
    </svg>
  );
}
