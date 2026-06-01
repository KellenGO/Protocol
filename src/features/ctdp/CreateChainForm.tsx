import { useEffect, useState } from 'react';
import { createChain, getAppSettings } from '../../lib/db';
import type { Chain } from '../../types';
import ChainProtocolForm, { type ChainProtocolFormValues } from './ChainProtocolForm';
import {
  AUXILIARY_COMPLETION_TEMPLATES,
  AUXILIARY_TRIGGER_PRESETS,
  COMPLETION_CONDITION_TEMPLATES,
  MAIN_TRIGGER_PRESETS,
} from './protocolOptions';

interface Props {
  onCreated: (chain: Chain) => void;
  onCancel: () => void;
}

export default function CreateChainForm({ onCreated, onCancel }: Props) {
  const [focusDuration, setFocusDuration] = useState(25);
  const [auxiliaryDelay, setAuxiliaryDelay] = useState(15);

  useEffect(() => {
    getAppSettings()
      .then((settings) => {
        const focusDefault = settings.find((s) => s.key === 'default_focus_duration');
        if (focusDefault) {
          const value = parseInt(focusDefault.value, 10);
          if (value > 0) setFocusDuration(value);
        }

        const reservationDefault = settings.find((s) => s.key === 'default_reservation_duration');
        if (reservationDefault) {
          const value = parseInt(reservationDefault.value, 10);
          if (value > 0) setAuxiliaryDelay(value);
        }
      })
      .catch(() => {});
  }, []);

  const initialValues: ChainProtocolFormValues = {
    name: '',
    description: '',
    triggerAction: MAIN_TRIGGER_PRESETS[0],
    completionCondition: COMPLETION_CONDITION_TEMPLATES[0],
    focusDurationMinutes: focusDuration,
    auxiliaryTriggerAction: AUXILIARY_TRIGGER_PRESETS[0],
    auxiliaryDelayMinutes: auxiliaryDelay,
    auxiliaryCompletionCondition: AUXILIARY_COMPLETION_TEMPLATES[0],
  };

  async function handleSubmit(values: ChainProtocolFormValues) {
    const chain = await createChain(values);
    onCreated(chain);
  }

  return (
    <ChainProtocolForm
      title="新建主链"
      submitLabel="创建"
      submittingLabel="创建中..."
      initialValues={initialValues}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
