/**
 * Applies published Sync_Change__e events to the ERP in batches, checkpointing the
 * replay id after each batch so a failed callout resumes from the last applied event
 * rather than from the start of the retention window.
 *
 * Why the checkpoint matters to the referee: the subscriber can only resume within
 * the 72-hour retention of high-volume events. An outage longer than that loses the
 * events, and the offline referee reports the differences they would have explained
 * as "window closed" rather than guessing a side.
 */
trigger SyncChangeSubscriber on Sync_Change__e (after insert) {
    List<Sync_Change__e> batch = new List<Sync_Change__e>();
    for (Sync_Change__e event : Trigger.new) {
        batch.add(event);
        if (batch.size() == 50) {
            SyncOutboundService.apply(batch);
            EventBus.TriggerContext.currentContext().setResumeCheckpoint(event.ReplayId);
            batch.clear();
        }
    }
    if (!batch.isEmpty()) {
        SyncOutboundService.apply(batch);
        EventBus.TriggerContext.currentContext().setResumeCheckpoint(batch[batch.size() - 1].ReplayId);
    }
}
