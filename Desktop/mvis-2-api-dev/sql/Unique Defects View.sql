CREATE OR REPLACE VIEW unique_defects AS
SELECT DISTINCT ON (mpi.train_id, mpi.tagged_wagon_id, mpi.tagged_bogie_id, mpi.side, mpi.defect_image)
    mpi.id,
    mpi.dpu_id,
    mpi.train_id,
    mpi.wagon_id,
    mpi.wagon_type,
    mpi.loco_no,
    mpi.mvis_total_axles,
    mpi.mvis_train_speed,
    mpi.dfis_train_id,
    mpi.tagged_wagon_id,
    mpi.tagged_bogie_id,
    mpi.side,
    mpi.defect_image,
    mpi.defect_code,
    mpi.action_taken,
    mpi.remarks,
    mpi.start_ts,
    mpi.field_report,
    mpi.ts,
    mpi.generated_by,
    mpi.is_deleted
FROM
    mvis_processed_info mpi
WHERE
    mpi.defect_code != '-'
ORDER BY
    mpi.train_id, mpi.tagged_wagon_id, mpi.tagged_bogie_id, mpi.side, mpi.defect_image,
    mpi.id ASC;
