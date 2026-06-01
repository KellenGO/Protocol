import { updateChain } from '../../lib/db';
import type { Chain } from '../../types';
import ChainProtocolForm, { type ChainProtocolFormValues } from './ChainProtocolForm';
import {
  AUXILIARY_COMPLETION_TEMPLATES,
  COMPLETION_CONDITION_TEMPLATES,
} from './protocolOptions';

interface Props {
  chain: Chain;
  onUpdated: (chain: Chain) => void;
  onCancel: () => void;
}

export default function EditChainForm({ chain, onUpdated, onCancel }: Props) {
  const initialValues: ChainProtocolFormValues = {
    name: chain.name,
    description: chain.description,
    triggerAction: chain.trigger_action,
    completionCondition: chain.completion_condition || COMPLETION_CONDITION_TEMPLATES[0],
    focusDurationMinutes: chain.focus_duration_minutes,
    auxiliaryTriggerAction: chain.auxiliary_trigger_action,
    auxiliaryDelayMinutes: chain.auxiliary_delay_minutes,
    auxiliaryCompletionCondition: chain.auxiliary_completion_condition || AUXILIARY_COMPLETION_TEMPLATES[0],
  };

  async function handleSubmit(values: ChainProtocolFormValues) {
    const updated = await updateChain(chain.id, values);
    onUpdated(updated);
  }

  return (
    <ChainProtocolForm
      title="编辑主链"
      submitLabel="保存"
      submittingLabel="保存中..."
      initialValues={initialValues}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
