// Copyright (c) 2023-2024 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

#ifndef FLYBYWIRE_AIRCRAFT_THRUSTLIMITS_A380X_HPP
#define FLYBYWIRE_AIRCRAFT_THRUSTLIMITS_A380X_HPP

#include <algorithm>
#include <map>
#include <sstream>

#include "logging.h"

#include "EngineRatios.hpp"
#include "Fadec.h"

/**
 * @class ThrustLimits_A3800X
 * @brief Static class containing the thrust limits for the A380X.
 *
 * TODO: extract the reusable code to a common library
 */
class ThrustLimits_A380X {
  /**
   * @brief A 2D array representing various engine thrust limits.
   *
   * This 2D array contains 72 rows, each with 6 columns. Each row represents a different altitude
   * level and the corresponding engine thrust
   * limits. The columns in each row represent the following parameters:
   * 1. Altitude (in feet)
   * 2. Corner Point (CP) - the temperature below which the engine can operate at full thrust without any restrictions.
   * 3. Limit Point (LP) - the temperature above which the engine thrust starts to be limited.
   * 4. CN1 Flat - the engine's N1 fan speed limit at the CP temperature.
   * 5. CN1 Last - the engine's N1 fan speed limit at the LP temperature.
   * 6. CN1 Flex - the engine's N1 fan speed limit at a temperature of 100 degrees Celsius.
   *
   * The array is divided into sections for different flight phases: Takeoff (TO), Go-Around (GA),
   * Climb (CLB), and Maximum Continuous Thrust (MCT).
   */
  static constexpr double limits[72][6] = {
  // TO
      {-2000,   48.000,  55.000,  81.351, 79.370, 61.535}, // row 0
      {-1000,   46.000,  55.000,  82.605, 80.120, 62.105}, //
      {0,       44.000,  55.000,  83.832, 80.776, 62.655}, //
      {500,     42.000,  52.000,  84.210, 81.618, 62.655}, //
      {1000,    42.000,  52.000,  84.579, 81.712, 62.655}, //
      {2000,    40.000,  50.000,  85.594, 82.720, 62.655}, //
      {3000,    36.000,  48.000,  86.657, 83.167, 61.960}, //
      {4000,    32.000,  46.000,  87.452, 83.332, 61.206}, //
      {5000,    29.000,  44.000,  88.833, 84.166, 61.206}, //
      {6000,    25.000,  42.000,  90.232, 84.815, 61.206}, //
      {7000,    21.000,  40.000,  91.711, 85.565, 61.258}, //
      {8000,    17.000,  38.000,  93.247, 86.225, 61.777}, //
      {9000,    15.000,  36.000,  94.031, 86.889, 60.968}, //
      {10000,   13.000,  34.000,  94.957, 88.044, 60.935}, //
      {11000,   12.000,  32.000,  95.295, 88.526, 59.955}, //
      {12000,   11.000,  30.000,  95.568, 88.818, 58.677}, //
      {13000,   10.000,  28.000,  95.355, 88.819, 59.323}, //
      {14000,   10.000,  26.000,  95.372, 89.311, 59.965}, //
      {15000,   8.000,   24.000,  95.686, 89.907, 58.723}, //
      {16000,   5.000,   22.000,  96.160, 89.816, 57.189}, //
      {16600,   5.000,   22.000,  96.560, 89.816, 57.189}, // row 20
  // GA
      {-2000,   47.751,  54.681,  84.117, 81.901, 63.498}, // row 21
      {-1000,   45.771,  54.681,  85.255, 82.461, 63.920}, //
      {0,       43.791,  54.681,  86.411, 83.021, 64.397}, //
      {500,     42.801,  52.701,  86.978, 83.740, 64.401}, //
      {1000,    41.811,  52.701,  87.568, 83.928, 64.525}, //
      {2000,    38.841,  50.721,  88.753, 84.935, 64.489}, //
      {3000,    36.861,  48.741,  89.930, 85.290, 63.364}, //
      {4000,    32.901,  46.761,  91.004, 85.836, 62.875}, //
      {5000,    28.941,  44.781,  92.198, 86.293, 62.614}, //
      {6000,    24.981,  42.801,  93.253, 86.563, 62.290}, //
      {7000,    21.022,  40.821,  94.273, 86.835, 61.952}, //
      {8000,    17.062,  38.841,  94.919, 87.301, 62.714}, //
      {9000,    15.082,  36.861,  95.365, 87.676, 61.692}, //
      {10000,   13.102,  34.881,  95.914, 88.150, 60.906}, //
      {11000,   12.112,  32.901,  96.392, 88.627, 59.770}, //
      {12000,   11.122,  30.921,  96.640, 89.206, 58.933}, //
      {13000,   10.132,  28.941,  96.516, 89.789, 60.503}, //
      {14000,   9.142,   26.961,  96.516, 90.475, 62.072}, //
      {15000,   9.142,   24.981,  96.623, 90.677, 59.333}, //
      {16000,   7.162,   23.001,  96.845, 90.783, 58.045}, //
      {16600,   5.182,   21.022,  97.366, 91.384, 58.642}, // row 41
  // CLB
      {-2000,   30.800,  56.870,  80.280, 72.000, 0.000 }, // row 42
      {2000,    20.990,  48.157,  82.580, 74.159, 0.000 }, //
      {5000,    16.139,  43.216,  84.642, 75.737, 0.000 }, //
      {8000,    7.342,   38.170,  86.835, 77.338, 0.000 }, //
      {10000,   4.051,   34.518,  88.183, 77.999, 0.000 }, //
      {10000.1, 4.051,   34.518,  87.453, 77.353, 0.000 }, //
      {12000,   0.760,   30.865,  88.303, 78.660, 0.000 }, //
      {15000,   -4.859,  25.039,  89.748, 79.816, 0.000 }, //
      {17000,   -9.934,  19.813,  90.668, 80.895, 0.000 }, //
      {20000,   -15.822, 13.676,  92.106, 81.894, 0.000 }, //
      {24000,   -22.750, 6.371,   94.588, 83.543, 0.000 }, //       +1%
      {27000,   -29.105, -0.304,  96.203, 85.358, 0.000 }, // +1% +1%
      {29314,   -32.049, -3.377,  96.820, 85.906, 0.000 }, // +1% +1%
      {31000,   -34.980, -6.452,  98.568, 86.909, 0.000 }, // +2% +1%
      {35000,   -45.679, -17.150, 100.977, 89.570, 0.000 }, // +3% +1%
      {39000,   -45.679, -17.150, 103.085, 90.377, 0.000 }, // +3% +1%
      {41500,   -45.679, -17.150, 104.509, 91.476, 0.000 }, // row 58 +3% +1%
  // MCT
      {-1000,   26.995,  54.356,  82.465, 74.086, 0.000 }, // row 59
      {3000,    18.170,  45.437,  86.271, 77.802, 0.000 }, //
      {7000,    9.230,   40.266,  89.128, 79.604, 0.000 }, //
      {11000,   4.019,   31.046,  92.194, 82.712, 0.000 }, //
      {15000,   -5.226,  21.649,  95.954, 85.622, 0.000 }, //
      {17000,   -9.913,  20.702,  97.520, 85.816, 0.000 }, //
      {20000,   -15.129, 15.321,  99.263, 86.770, 0.000 }, //
      {22000,   -19.947, 10.382,  98.977, 86.661, 0.000 }, //
      {25000,   -25.397, 4.731,   99.424, 86.623, 0.000 }, //     +1%
      {27000,   -30.369, -0.391,  99.730, 87.711, 0.000 }, // +1% +1%
      {31000,   -36.806, -7.165,  101.958, 89.534, 0.000 }, // +2% +1%
      {35000,   -43.628, -14.384, 103.375, 90.095, 0.000 }, // +3% +1%
      {39000,   -47.286, -18.508, 104.234, 91.663, 0.000 }  // row 71 +3% +1%
  };

 public:
  /**
   * @brief Finds the top-row boundary in the limits array.
   *
   * @param altitude The altitude to find the top-row boundary for.
   * @param index The index to start the search from.
   * @return The index of the top-row boundary in the limits array.
   */
  static int finder(double altitude, int index) {
    while (altitude >= limits[index][0]) {
      index++;
    }
    return index;
  }

  /**
   * @brief Calculates the total bleed for the engine.
   *
   * @param type The type of operation (0-TO, 1-GA, 2-CLB, 3-MCT).
   * @param altitude The current altitude of the aircraft in feet.
   * @param oat The outside air temperature in degrees Celsius.
   * @param cp The corner point - the temperature below which the engine can operate at full thrust without any restrictions (in degrees
   * Celsius).
   * @param lp The limit point - the temperature above which the engine thrust starts to be limited (in degrees Celsius).
   * @param flexTemp The flex temperature in degrees Celsius.
   * @param packs The status of the air conditioning (0 for off, 1 for on).
   * @param nacelle The status of the nacelle anti-ice (0 for off, 1 for on).
   * @param wing The status of the wing anti-ice (0 for off, 1 for on).
   * @return The total bleed for the engine
   */
  static double bleedTotal(int    type,      //
                           double altitude,  //
                           double oat,       //
                           double cp,        //
                           double lp,        //
                           double flexTemp,  //
                           int    packs,     //
                           int    nacelle,   //
                           int    wing       //
  ) {
    if (flexTemp > lp && type <= 1) {
      return packs * -0.6 + nacelle * -0.7 + wing * -0.7;
    }

    // Define a map to store the bleed values for different conditions
    // Keys:
    // int - Represents the type of operation (0-TO, 1-GA, 2-CLB, 3-MCT).
    // bool - Represents whether the altitude is less than 8000.
    // bool - Represents whether the outside air temperature is less than the corner point.
    // Values:
    // double - Represents the bleed value for the packs.
    // double - Represents the bleed value for the nacelle anti-ice.
    // double - Represents the bleed value for the wing anti-ice.
    std::map<std::tuple<int, bool, bool>, std::tuple<double, double, double>> bleedValues = {
        {{0, true, true},   {-0.4, -0.6, -0.7}}, //
        {{0, true, false},  {-0.5, -0.6, -0.7}}, //
        {{0, false, true},  {-0.6, -0.8, -0.8}}, //
        {{0, false, false}, {-0.7, -0.8, -0.8}}, //
        {{1, true, true},   {-0.4, -0.6, -0.6}}, //
        {{1, true, false},  {-0.4, -0.6, -0.6}}, //
        {{1, false, true},  {-0.6, -0.7, -0.8}}, //
        {{1, false, false}, {-0.6, -0.7, -0.8}}, //
        {{2, true, false},  {-0.2, -0.8, -0.4}}, //
        {{2, false, false}, {-0.3, -0.8, -0.4}}, //
        {{3, true, false},  {-0.6, -0.9, -1.2}}, //
        {{3, false, false}, {-0.6, -0.9, -1.2}}  //
    };

    double n1Packs = 0;
    double n1Nai   = 0;
    double n1Wai   = 0;

    // Use the map to get the bleed values
    std::tie(n1Packs, n1Nai, n1Wai) = bleedValues[{type, altitude < 8000, oat < cp}];

    return packs * n1Packs + nacelle * n1Nai + wing * n1Wai;
  }

  // DCL thr% lookup tables (derated climb thrust as % of MCL N1)
  // Rows: TAT (°C), Columns: altitude (ft)
  static constexpr double dclTatBreakpoints[19] = {
      -60, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60};

  static constexpr double dclAltBreakpoints[12] = {
      -1000, 3000, 7000, 11000, 15000, 19000, 23000, 27000, 31000, 35000, 39000, 43000};

  // [level][tatRow][altCol], level 0 = MAX CLB, 1 = DERATE 01, 2 = DERATE 02, 3 = DERATE 03
  static constexpr double dclThr[4][19][12] = {{
      // MAX CLB
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 98.2, 98.2, 98.5, 98.5, 98.3, 98.1},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 98.2, 98.2, 98.5, 98.5, 98.3, 98.1},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 98.2, 98.2, 98.5, 98.5, 98.3, 98.1},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 98.2, 98.2, 98.5, 98.5, 98.3, 98.1},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 98.2, 98.2, 98.5, 98.5, 98.3, 98.1},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 98.2, 98.2, 98.5, 98.4, 98.1, 97.6},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 98.2, 98.2, 98.2, 97.9, 97.6, 97.2},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 98.2, 98.1, 98.0, 97.7, 97.3, 97.1},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.2, 97.9, 98.0, 98.0, 97.7, 97.3, 96.5},
      {98.4, 98.2, 98.1, 98.1, 98.0, 97.5, 97.7, 97.6, 97.9, 97.1, 96.5, 95.9},
      {98.4, 98.2, 98.1, 98.1, 97.8, 97.3, 97.2, 97.1, 97.3, 96.7, 100.0, 100.0},
      {98.4, 98.2, 95.1, 98.0, 98.0, 97.0, 96.9, 96.9, 96.9, 100.0, 100.0, 100.0},
      {98.4, 96.7, 94.0, 98.0, 97.9, 96.9, 96.8, 96.8, 96.8, 100.0, 100.0, 100.0},
      {98.4, 94.0, 95.9, 98.0, 97.8, 96.8, 96.8, 96.7, 100.0, 100.0, 100.0, 100.0},
      {97.6, 95.3, 95.7, 97.9, 97.7, 96.6, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {93.1, 94.3, 94.4, 97.9, 97.7, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {92.6, 92.7, 93.1, 98.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {90.7, 91.1, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {89.6, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
  },
  {
      // DERATE 01
      {95.3, 96.4, 96.4, 96.1, 96.5, 96.5, 96.5, 96.5, 96.3, 98.8, 98.6, 98.1},
      {95.3, 96.4, 96.4, 96.1, 96.5, 96.4, 96.5, 96.5, 96.3, 98.8, 98.6, 98.0},
      {95.3, 96.4, 96.4, 96.1, 96.5, 96.4, 96.5, 96.5, 96.3, 98.8, 98.6, 98.0},
      {95.3, 96.4, 96.4, 96.1, 96.5, 96.4, 96.5, 96.5, 96.3, 98.8, 98.6, 98.0},
      {95.3, 96.4, 96.4, 96.1, 96.5, 96.3, 96.5, 96.5, 96.3, 98.8, 98.4, 97.9},
      {95.3, 96.4, 96.4, 96.1, 96.5, 96.3, 96.5, 96.4, 96.2, 98.6, 98.3, 97.7},
      {95.3, 96.4, 96.4, 96.1, 96.5, 96.3, 96.5, 96.4, 96.3, 98.5, 98.1, 97.2},
      {95.3, 96.4, 96.4, 96.1, 96.4, 96.3, 96.5, 96.4, 97.6, 98.3, 97.8, 96.8},
      {95.2, 96.4, 96.4, 96.1, 96.4, 96.2, 96.2, 96.2, 98.5, 97.9, 97.4, 96.4},
      {95.2, 96.4, 96.4, 96.1, 96.4, 96.2, 96.1, 95.9, 98.3, 97.7, 97.1, 96.1},
      {95.2, 96.4, 96.4, 96.1, 96.3, 96.0, 95.9, 98.3, 98.1, 97.5, 100.0, 100.0},
      {95.2, 96.4, 95.6, 96.1, 96.2, 95.9, 95.8, 98.1, 97.9, 100.0, 100.0, 100.0},
      {95.2, 95.5, 93.7, 96.0, 96.2, 95.7, 97.9, 97.8, 100.0, 100.0, 100.0, 100.0},
      {95.2, 92.1, 92.8, 95.9, 96.1, 95.7, 97.9, 100.0, 100.0, 100.0, 100.0, 100.0},
      {90.6, 91.3, 91.3, 95.8, 96.0, 95.5, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {89.8, 89.5, 90.0, 95.7, 95.8, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {87.8, 87.7, 88.7, 95.6, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {85.5, 86.3, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {83.8, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
  },
  {
      // DERATE 02
      {88.9, 89.9, 90.0, 89.6, 90.7, 90.5, 90.6, 90.7, 92.4, 98.8, 98.6, 98.1},
      {88.8, 89.8, 90.0, 89.5, 90.6, 90.2, 90.4, 90.5, 92.3, 98.8, 98.6, 98.0},
      {88.8, 89.8, 89.9, 89.5, 90.6, 90.2, 90.4, 90.5, 92.3, 98.8, 98.6, 98.0},
      {88.8, 89.8, 89.9, 89.5, 90.6, 90.2, 90.3, 90.4, 92.3, 98.8, 98.6, 98.0},
      {88.8, 89.7, 89.9, 89.5, 90.5, 90.1, 90.3, 90.4, 92.3, 98.8, 98.4, 97.9},
      {88.8, 89.7, 89.9, 89.5, 90.5, 90.1, 90.3, 90.4, 92.3, 98.6, 98.3, 97.7},
      {88.7, 89.7, 89.9, 89.5, 90.5, 90.1, 90.3, 90.4, 94.4, 98.5, 98.1, 97.2},
      {88.7, 89.7, 89.9, 89.5, 90.5, 90.0, 90.3, 90.2, 97.6, 98.3, 97.8, 96.8},
      {88.7, 89.7, 89.9, 89.5, 90.5, 90.0, 90.0, 90.0, 98.5, 97.9, 97.4, 96.4},
      {88.7, 89.7, 89.9, 89.5, 90.5, 89.9, 89.9, 92.9, 98.3, 97.7, 97.1, 96.1},
      {88.7, 89.7, 89.9, 89.5, 90.4, 89.8, 89.9, 98.3, 98.1, 97.5, 100.0, 100.0},
      {88.7, 89.7, 89.0, 89.4, 90.3, 89.8, 90.8, 98.1, 97.9, 100.0, 100.0, 100.0},
      {88.7, 88.9, 87.3, 89.3, 90.3, 89.7, 96.4, 97.9, 97.8, 100.0, 100.0, 100.0},
      {88.6, 85.6, 86.5, 89.2, 90.3, 89.8, 97.9, 97.8, 100.0, 100.0, 100.0, 100.0},
      {84.4, 85.0, 85.2, 89.3, 90.3, 94.3, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {83.6, 83.3, 83.9, 89.3, 90.3, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {81.8, 81.6, 82.7, 89.3, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {79.6, 80.4, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {78.1, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
  },
  {
      // DERATE 03
      {84.2, 85.0, 85.3, 84.8, 86.4, 85.9, 85.9, 85.9, 92.4, 98.8, 98.6, 98.1},
      {84.1, 84.9, 85.2, 84.7, 86.3, 85.6, 85.7, 85.6, 92.3, 98.8, 98.6, 98.0},
      {84.1, 84.9, 85.2, 84.7, 86.3, 85.6, 85.6, 85.6, 92.3, 98.8, 98.6, 98.0},
      {84.1, 84.9, 85.2, 84.7, 86.3, 85.5, 85.6, 85.6, 92.3, 98.8, 98.6, 98.0},
      {84.1, 84.9, 85.2, 84.7, 86.2, 85.5, 85.6, 85.5, 92.3, 98.8, 98.4, 97.9},
      {84.0, 84.9, 85.2, 84.7, 86.2, 85.5, 85.5, 85.5, 92.3, 98.6, 98.3, 97.7},
      {84.0, 84.8, 85.1, 84.7, 86.2, 85.4, 85.5, 85.5, 94.4, 98.5, 98.1, 97.2},
      {84.0, 84.8, 85.1, 84.7, 86.2, 85.4, 85.5, 85.4, 97.6, 98.3, 97.8, 96.8},
      {84.0, 84.8, 85.1, 84.7, 86.2, 85.4, 85.3, 88.7, 98.5, 97.9, 97.4, 96.4},
      {84.0, 84.8, 85.1, 84.7, 86.2, 85.3, 85.5, 92.9, 98.3, 97.7, 97.1, 96.1},
      {84.0, 84.8, 85.1, 84.7, 86.1, 85.4, 85.5, 98.3, 98.1, 97.5, 100.0, 100.0},
      {83.9, 84.8, 84.3, 84.6, 86.0, 85.4, 90.8, 98.1, 97.9, 100.0, 100.0, 100.0},
      {83.9, 84.1, 82.7, 84.5, 86.0, 85.5, 96.4, 97.9, 97.8, 100.0, 100.0, 100.0},
      {83.9, 81.0, 81.9, 84.4, 86.1, 88.6, 97.9, 97.8, 100.0, 100.0, 100.0, 100.0},
      {79.9, 80.5, 80.7, 84.5, 86.2, 94.3, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {79.1, 78.9, 79.6, 84.8, 86.8, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {77.5, 77.3, 78.5, 84.8, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {75.5, 76.2, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
      {74.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0},
  }};

  static int dclFindIdx(const double* breakpoints, int count, double value) {
    if (value <= breakpoints[0]) return 0;
    if (value >= breakpoints[count - 1]) return count - 2;
    int idx = 1;
    while (idx < count - 1 && value >= breakpoints[idx]) idx++;
    return idx - 1;
  }

  static double bilinearLookup(const double* gridTat, const double* gridAlt, const double* table, int tatCount, int altCount, double tat, double alt) {
    int ti = dclFindIdx(gridTat, tatCount, tat);
    int ai = dclFindIdx(gridAlt, altCount, alt);
    double tFrac = (gridTat[ti + 1] - gridTat[ti]) == 0 ? 0 : (tat - gridTat[ti]) / (gridTat[ti + 1] - gridTat[ti]);
    double aFrac = (gridAlt[ai + 1] - gridAlt[ai]) == 0 ? 0 : (alt - gridAlt[ai]) / (gridAlt[ai + 1] - gridAlt[ai]);
    double v00 = table[ti * altCount + ai];
    double v10 = table[(ti + 1) * altCount + ai];
    double v01 = table[ti * altCount + (ai + 1)];
    double v11 = table[(ti + 1) * altCount + (ai + 1)];
    double v0 = v00 + (v10 - v00) * tFrac;
    double v1 = v01 + (v11 - v01) * tFrac;
    return v0 + (v1 - v0) * aFrac;
  }

  static double climbDerateFactor(int level, double tat, double altitude) {
    if (level < 0 || level > 3) return 100.0;
    return bilinearLookup(dclTatBreakpoints, dclAltBreakpoints, &dclThr[level][0][0], 19, 12, tat, altitude);
  }

  /**
   * @brief Calculates the N1 limit based on the given parameters.
   *
   * This function calculates the N1 limit based on the type of limit, altitude, ambient temperature,
   * ambient pressure, flex temperature, and the status of the air conditioning, nacelle anti-ice,
   * and wing anti-ice. It uses a series of calculations and interpolations
   * to determine the N1 limit.
   *
   * @param type An integer representing the type of limit (0-TO, 1-GA, 2-CLB, 3-MCT).
   * @param altitude A double representing the altitude.
   * @param ambientTemp A double representing the ambient temperature.
   * @param ambientPressure A double representing the ambient pressure.
   * @param flexTemp A double representing the flex temperature.
   * @param packs A double representing the air conditioning status.
   * @param nacelle A double representing the nacelle anti-ice status.
   * @param wing A double representing the wing anti-ice status.
   * @return The N1 limit as a double.
   */
  static double limitN1(int    type,             //
                        double altitude,         //
                        double ambientTemp,      //
                        double ambientPressure,  //
                        double flexTemp,         //
                        double packs,            //
                        double nacelle,          //
                        double wing              //
  ) {
    int    rowMin   = 0;
    int    rowMax   = 0;
    int    loAltRow = 0;
    int    hiAltRow = 0;
    double mach     = 0;

    // Set main variables per Limit Type
    switch (type) {
      case 0:  // TO
        rowMin = 0;
        rowMax = 20;
        mach   = 0;
        break;
      case 1:  // GA
        rowMin = 21;
        rowMax = 41;
        mach   = 0.225;
        break;
      case 2:  // CLB
        rowMin = 42;
        rowMax = 58;
        if (altitude <= 10000) {
          mach = Fadec::cas2mach(250, ambientPressure);
        } else {
          mach = Fadec::cas2mach(300, ambientPressure);
          if (mach > 0.78)
            mach = 0.78;
        }
        break;
      case 3:  // MCT
        rowMin = 59;
        rowMax = 71;
        mach   = Fadec::cas2mach(230, ambientPressure);
        break;
    }

    // Check for over/under flows. Else, find top row value
    if (altitude <= limits[rowMin][0]) {
      hiAltRow = rowMin;
      loAltRow = rowMin;
    } else if (altitude >= limits[rowMax][0]) {
      hiAltRow = rowMax;
      loAltRow = rowMax;
    } else {
      hiAltRow = finder(altitude, rowMin);
      loAltRow = hiAltRow - 1;
    }

    // Define key table variables and interpolation
    const double cp      = Fadec::interpolate(altitude, limits[loAltRow][0], limits[hiAltRow][0], limits[loAltRow][1], limits[hiAltRow][1]);
    const double lp      = Fadec::interpolate(altitude, limits[loAltRow][0], limits[hiAltRow][0], limits[loAltRow][2], limits[hiAltRow][2]);
    const double cn1Flat = Fadec::interpolate(altitude, limits[loAltRow][0], limits[hiAltRow][0], limits[loAltRow][3], limits[hiAltRow][3]);
    const double cn1Last = Fadec::interpolate(altitude, limits[loAltRow][0], limits[hiAltRow][0], limits[loAltRow][4], limits[hiAltRow][4]);
    const double cn1Flex = Fadec::interpolate(altitude, limits[loAltRow][0], limits[hiAltRow][0], limits[loAltRow][5], limits[hiAltRow][5]);

    double cn1 = 0;
    double m   = 0;
    double b   = 0;
    if (flexTemp > 0 && type <= 1) {  // CN1 for Flex Case
      if (flexTemp <= cp) {
        cn1 = cn1Flat;
      } else if (flexTemp > lp) {
        m   = (cn1Flex - cn1Last) / (100 - lp);
        b   = cn1Flex - m * 100;
        cn1 = (m * flexTemp) + b;
      } else {
        m   = (cn1Last - cn1Flat) / (lp - cp);
        b   = cn1Last - m * lp;
        cn1 = (m * flexTemp) + b;
      }
    } else {  // CN1 for All other cases
      if (ambientTemp <= cp) {
        cn1 = cn1Flat;
      } else {
        m   = (cn1Last - cn1Flat) / (lp - cp);
        b   = cn1Last - m * lp;
        cn1 = (m * ambientTemp) + b;
      }
    }

    // Define bleed rating/ de-rating
    const double bleed = bleedTotal(type, altitude, ambientTemp, cp, lp, flexTemp, packs, nacelle, wing);

    return (cn1 * (std::sqrt)(EngineRatios::theta2(mach, ambientTemp))) + bleed;
  }
};

#endif  // FLYBYWIRE_AIRCRAFT_THRUSTLIMITS_A380X_HPP
