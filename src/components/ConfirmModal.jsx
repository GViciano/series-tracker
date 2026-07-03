export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        <p>{message}</p>
        <div className="modal-actions">
          <button className="modal-cancel-btn" onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? 'modal-danger-btn' : 'modal-confirm-btn'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
