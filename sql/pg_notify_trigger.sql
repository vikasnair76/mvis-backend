-- TODO: For MVIS 3 move the notification to business/application layer.

-- Trigger for new train
CREATE TRIGGER trg_notify_mvis_processed_info
AFTER INSERT OR UPDATE ON mvis_processed_info
FOR EACH ROW
EXECUTE FUNCTION notify_mvis_processed_info();

-- Function for new train

CREATE OR REPLACE FUNCTION notify_mvis_processed_info()
RETURNS TRIGGER AS $$
DECLARE
    payload TEXT;
    existing_count INTEGER;
BEGIN
    IF coalesce(lower(trim(NEW.generated_by)), '') LIKE '%manual%' THEN
        RAISE NOTICE 'Skipping notify_mvis_processed_info: train_id=%, generated_by=%', NEW.train_id, NEW.generated_by;
        RETURN NEW;
    END IF;
    SELECT COUNT(*) INTO existing_count
    FROM mvis_processed_info
    WHERE train_id = NEW.train_id
      AND id <> NEW.id
      AND defect_code IS NOT NULL
      AND defect_image IS NOT NULL;

    IF existing_count = 0 THEN
        payload := json_build_object(
            'data', json_build_object(
                'id', NEW.id,
                'ts', NEW.ts,
                'train_id', NEW.train_id,
                'dpu_id', NEW.dpu_id,
                'wagon_id', NEW.wagon_id,
                'wagon_type', NEW.wagon_type,
                'defect_code', NEW.defect_code,
                'defect_image', NEW.defect_image,
                'side', NEW.side,
                'action_taken', NEW.action_taken,
                'loco_no', NEW.loco_no,
                'mvis_train_speed', NEW.mvis_train_speed,
                'field_report', NEW.field_report,
                'remarks', NEW.remarks
            ),
            'event_type', 'train_update'
        )::text;

        PERFORM pg_notify('mvis_processed_info_channel', payload);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for new defect
CREATE TRIGGER trg_notify_new_defect
AFTER INSERT OR UPDATE ON mvis_processed_info
FOR EACH ROW
EXECUTE FUNCTION notify_new_defect_for_train();

-- Function for new defect

CREATE OR REPLACE FUNCTION notify_new_defect_for_train()
RETURNS TRIGGER AS $$
DECLARE
    payload TEXT;
    exists_already BOOLEAN;
    defect_name TEXT;
    should_alert BOOLEAN;
    is_defect_active BOOLEAN;
BEGIN
    IF coalesce(lower(trim(NEW.generated_by)), '') LIKE '%manual%' THEN
        RAISE NOTICE 'Skipping notify_mvis_processed_info: train_id=%, generated_by=%', NEW.train_id, NEW.generated_by;
        RETURN NEW;
    END IF;
    IF NEW.defect_code IS NOT NULL AND NEW.defect_code <> '-' 
    AND NEW.defect_image IS NOT NULL AND NEW.defect_image <> '-' THEN

        -- Fetch component details name from defect_types table
        SELECT name, show_alert, is_active 
        INTO defect_name, should_alert, is_defect_active
        FROM defect_types 
        WHERE defect_code = NEW.defect_code;

        IF should_alert = TRUE AND is_defect_active = TRUE THEN
            SELECT EXISTS (
                SELECT 1 FROM mvis_processed_info
                WHERE train_id = NEW.train_id
                AND defect_code = NEW.defect_code
                AND defect_image = NEW.defect_image
                AND id <> NEW.id
            ) INTO exists_already;

            IF NOT exists_already THEN
                payload := json_build_object(
                    'data', json_build_object(
                        'train_id', NEW.train_id,
                        'ts', NEW.ts,
                        'dpu_id', NEW.dpu_id,
                        'defect_code', NEW.defect_code,
                        'defect_name', defect_name,
                        'defect_image', NEW.defect_image,
                        'wagon_id', NEW.wagon_id,
                        'side', NEW.side,
                        'tagged_bogie_id', NEW.tagged_bogie_id
                    ),
                    'event_type', 'new_defect'
                )::text;
                PERFORM pg_notify('mvis_processed_info_channel', payload);
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- trigger to notify about alert defects for trains

create or replace trigger trigger_notify_alert_defect after
insert 
    on
    public.mvis_processed_info for each row execute function notify_alert_defect_for_train()

-- Function to notify about alert defects for trains

CREATE OR REPLACE FUNCTION public.notify_alert_defect_for_train()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    payload TEXT;
    exists_already BOOLEAN;
    should_alert BOOLEAN;
    is_defect_active BOOLEAN;
    is_safe_train BOOLEAN;
    should_notify BOOLEAN;
BEGIN
    -- Check if this is a safe train (no defects)
    is_safe_train := (NEW.defect_code = '-' AND NEW.defect_image = '-');
    
    -- Determine if we should notify
    IF is_safe_train THEN
        should_notify := TRUE;
    ELSIF NEW.defect_code IS NOT NULL AND NEW.defect_code <> '-' 
          AND NEW.defect_image IS NOT NULL AND NEW.defect_image <> '-' THEN
        -- Fetch defect configuration
        SELECT show_alert, is_active 
        INTO should_alert, is_defect_active
        FROM defect_types 
        WHERE defect_code = NEW.defect_code;
        
        should_notify := (should_alert = TRUE AND is_defect_active = TRUE);
    ELSE
        should_notify := FALSE;
    END IF;
    
    -- If should notify, check for duplicates and send
    IF should_notify THEN
        SELECT EXISTS (
            SELECT 1
            FROM mvis_processed_info
            WHERE dpu_id = NEW.dpu_id
              AND train_id = NEW.train_id
              AND defect_code = NEW.defect_code
              AND defect_image = NEW.defect_image
              AND id <> NEW.id
        ) INTO exists_already;
        
        IF NOT exists_already THEN
            payload := json_build_object(
                'train_id', NEW.train_id,
                'ts', NEW.ts,
                'dpu_id', NEW.dpu_id,
                'defect_code', NEW.defect_code,
                'defect_image', NEW.defect_image,
                'loco_no', NEW.loco_no,
                'mvis_train_speed', NEW.mvis_train_speed,
                'event_type', 'alert_defect'
            )::text;
            
            PERFORM pg_notify('mvis_alert_defect_channel', payload);
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$
;