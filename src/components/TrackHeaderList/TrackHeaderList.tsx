      <div
        key={track.id}
        className={`${styles.row} ${isSelected ? styles.selected : ''} ${isActive ? styles.active : ''} ${dragOverTrackId === track.id ? styles.rowDropTarget : ''} ${draggedTrackId === track.id ? styles.rowDragging : ''}`}
        onClick={(e) => handleRowClick(e, track.id)}
        draggable
        onDragStart={(e) => handleDragStart(e, track.id)}
        onDragOver={(e) => handleDragOverTrack(e, track.id)}
        onDragLeave={handleDragLeaveTrack}
        onDrop={(e) => handleDropTrack(e, track.id)}
        onDragEnd={handleDragEnd}
        role="option"
        aria-selected={isSelected}
        aria-label={`Track ${track.name}`}
      >