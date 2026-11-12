/**
 * Publishes a Sync_Change__e for every contract field changed on an Account, after the
 * save, unless the change was committed by the bridge itself (an echo of the ERP).
 */
trigger AccountSyncPublisher on Account (after insert, after update) {
    SyncChangePublisher.publish(SyncChangePublisher.build('Account', Trigger.new, Trigger.oldMap));
}
