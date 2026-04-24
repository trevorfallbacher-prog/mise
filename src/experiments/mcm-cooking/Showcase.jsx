// Showcase shell for the MCM cooking-app experiment.
// Lives at URL hash `#mcm-cooking` (wired in src/App.jsx). Hosts
// the Pantry screen as the default entry point and layers the
// Cook screen + Unit picker modal on top as the user navigates.
//
// The background is painted by each screen — this shell just
// owns routing state and stacks the modal above everything.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import PantryScreen from "./PantryScreen";
import CookScreen from "./CookScreen";
import UnitPickerModal from "./UnitPickerModal";
import { color } from "./tokens";

export default function Showcase() {
  const [screen, setScreen] = useState("pantry"); // "pantry" | "cook"
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);

  const openUnitPicker  = () => setUnitPickerOpen(true);
  const closeUnitPicker = () => setUnitPickerOpen(false);

  return (
    <div style={{
      position: "relative",
      minHeight: "100vh",
      // Force light-mode body regardless of the ambient dark app
      // styling in index.html — this hash route is a sandbox.
      background: color.cream,
      color: color.ink,
    }}>
      <AnimatePresence mode="wait">
        {screen === "pantry" && (
          <motion.div
            key="pantry"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{    opacity: 0 }}
            transition={{ duration: 0.28 }}
          >
            <PantryScreen
              onStartCooking={() => setScreen("cook")}
              onOpenUnitPicker={openUnitPicker}
            />
          </motion.div>
        )}

        {screen === "cook" && (
          <motion.div
            key="cook"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{    opacity: 0 }}
            transition={{ duration: 0.28 }}
          >
            <CookScreen
              onBack={() => setScreen("pantry")}
              onOpenUnitPicker={openUnitPicker}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <UnitPickerModal
        open={unitPickerOpen}
        onClose={closeUnitPicker}
        onApply={() => {}}
      />
    </div>
  );
}
