/**
 * Builds and publishes one Sync_Change__e per changed contract field.
 *
 * Why this class exists: the two publisher triggers would otherwise duplicate the
 * diffing. It also holds the one rule that keeps the bridge from looping: a change
 * committed by the integration user is the ERP's own write arriving, so it is not
 * published back. The referee applies the same rule offline through
 * ChangeEventHeader.commitUser and changeOrigin (ADR-002).
 */
public with sharing class SyncChangePublisher {
    public static List<Sync_Change__e> build(String objectName, List<SObject> newRecords, Map<Id, SObject> oldRecords) {
        List<Sync_Change__e> events = new List<Sync_Change__e>();
        if (SyncContract.isBridgeUser()) {
            return events;
        }
        for (SObject record : newRecords) {
            SObject before = oldRecords == null ? null : oldRecords.get(record.Id);
            for (String field : SyncContract.fieldsFor(objectName)) {
                Object newValue = record.get(field);
                Object oldValue = before == null ? null : before.get(field);
                if (before != null && newValue == oldValue) {
                    continue;
                }
                events.add(new Sync_Change__e(
                    Record_Id__c = record.Id,
                    Object_Name__c = objectName,
                    Field_Name__c = field,
                    New_Value__c = newValue == null ? null : String.valueOf(newValue),
                    Source_User__c = UserInfo.getUserId(),
                    Occurred_At__c = System.now()
                ));
            }
        }
        return events;
    }

    public static Integer publish(List<Sync_Change__e> events) {
        if (events.isEmpty()) {
            return 0;
        }
        Integer published = 0;
        for (Database.SaveResult result : EventBus.publish(events)) {
            if (result.isSuccess()) {
                published += 1;
            }
        }
        return published;
    }
}
