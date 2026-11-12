/**
 * Publishes a Sync_Change__e for every contract field changed on a Contact, after the
 * save, unless the change was committed by the bridge itself (an echo of the ERP).
 */
trigger ContactSyncPublisher on Contact (after insert, after update) {
    SyncChangePublisher.publish(SyncChangePublisher.build('Contact', Trigger.new, Trigger.oldMap));
}
