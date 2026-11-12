@IsTest
private class SyncChangePublisherTest {
    @IsTest
    static void publishesOneEventPerChangedContractField() {
        Account before = new Account(Id = '001Kd0000000001AAA', Name = 'Old Name', Phone = '555-010-1001');
        Account after = new Account(Id = '001Kd0000000001AAA', Name = 'New Name', Phone = '555-010-1001');
        List<Sync_Change__e> events = SyncChangePublisher.build('Account', new List<SObject>{ after }, new Map<Id, SObject>{ before.Id => before });
        System.assertEquals(1, events.size(), 'only the changed field is published');
        System.assertEquals('Name', events[0].Field_Name__c);
        System.assertEquals('New Name', events[0].New_Value__c);
    }

    @IsTest
    static void insertPublishesEveryPopulatedContractField() {
        Contact created = new Contact(Id = '003Kd0000000001AAA', LastName = 'Okafor', Email = 'a@example.com', Title = 'Analyst');
        List<Sync_Change__e> events = SyncChangePublisher.build('Contact', new List<SObject>{ created }, null);
        Set<String> fields = new Set<String>();
        for (Sync_Change__e e : events) fields.add(e.Field_Name__c);
        System.assert(fields.contains('Email') && fields.contains('Title'), 'populated contract fields are published on insert');
    }

    @IsTest
    static void nonContractFieldsAreNotPublished() {
        Account before = new Account(Id = '001Kd0000000001AAA', Description = 'a');
        Account after = new Account(Id = '001Kd0000000001AAA', Description = 'b');
        List<Sync_Change__e> events = SyncChangePublisher.build('Account', new List<SObject>{ after }, new Map<Id, SObject>{ before.Id => before });
        System.assertEquals(0, events.size(), 'Description is not in the contract');
    }
}
