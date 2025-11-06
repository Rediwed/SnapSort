#!/usr/bin/env python3
"""
storage_optimizer.py

Simple helper to automatically configure SnapSort for different storage types.
Can be imported by photo_organizer.py or used standalone.
"""

import os
import subprocess
import shutil


def detect_storage_type(path: str) -> str:
    """Detect storage type (HDD vs SSD vs NVMe) for optimization."""
    try:
        # Try Linux-specific detection
        result = subprocess.run(['df', path], capture_output=True, text=True)
        if result.returncode == 0:
            device = result.stdout.split('\n')[1].split()[0]
            
            # NVMe detection
            if 'nvme' in device.lower():
                return 'nvme'
            
            # Check if rotational (HDD) vs non-rotational (SSD)
            device_name = device.split('/')[-1].rstrip('0123456789')
            rotational_path = f'/sys/block/{device_name}/queue/rotational'
            
            if os.path.exists(rotational_path):
                with open(rotational_path, 'r') as f:
                    is_rotational = f.read().strip() == '1'
                
                return 'hdd' if is_rotational else 'ssd'
        
        # Check for external drives
        if any(indicator in path.lower() for indicator in ['/media/', '/mnt/', 'usb']):
            return 'external'
            
    except Exception:
        pass
    
    return 'unknown'


def get_optimal_hash_settings(storage_type: str) -> dict:
    """Get optimal hash settings for detected storage type."""
    
    settings = {
        'nvme': {
            'enable_fast_hash': True,
            'fast_hash_bytes': 16384,  # 16KB - high bandwidth
            'description': 'NVMe SSD: Aggressive sampling for maximum speed'
        },
        'ssd': {
            'enable_fast_hash': True,
            'fast_hash_bytes': 8192,   # 8KB - balanced
            'description': 'SATA SSD: Balanced performance'
        },
        'hdd': {
            'enable_fast_hash': True,
            'fast_hash_bytes': 4096,   # 4KB - reduce seeks
            'description': 'HDD: Conservative sampling to minimize seeking'
        },
        'external': {
            'enable_fast_hash': True,
            'fast_hash_bytes': 2048,   # 2KB - very conservative
            'description': 'External drive: Very conservative for USB/network drives'
        },
        'unknown': {
            'enable_fast_hash': True,
            'fast_hash_bytes': 8192,   # Default
            'description': 'Unknown storage: Safe default settings'
        }
    }
    
    return settings.get(storage_type, settings['unknown'])


def configure_for_path(source_path: str) -> dict:
    """Detect storage and return optimal configuration."""
    storage_type = detect_storage_type(source_path)
    settings = get_optimal_hash_settings(storage_type)
    
    return {
        'storage_type': storage_type,
        'ENABLE_FAST_HASH': settings['enable_fast_hash'],
        'FAST_HASH_BYTES': settings['fast_hash_bytes'],
        'description': settings['description']
    }


def apply_optimizations_to_globals(source_path: str, globals_dict: dict):
    """
    Apply storage-specific optimizations to photo_organizer.py globals.
    
    Usage in photo_organizer.py:
        from storage_optimizer import apply_optimizations_to_globals
        apply_optimizations_to_globals(SOURCE_DIR, globals())
    """
    config = configure_for_path(source_path)
    
    # Update global variables
    globals_dict['ENABLE_FAST_HASH'] = config['ENABLE_FAST_HASH']
    globals_dict['FAST_HASH_BYTES'] = config['FAST_HASH_BYTES']
    
    return config


if __name__ == "__main__":
    # Test storage detection
    test_paths = [
        "/home/dewicadat/dev/Projects/SnapSort",
        "/",
        "/tmp"
    ]
    
    print("🔍 Storage Type Detection Test")
    print("=" * 40)
    
    for path in test_paths:
        if os.path.exists(path):
            config = configure_for_path(path)
            
            print(f"\nPath: {path}")
            print(f"Storage type: {config['storage_type']}")
            print(f"Description: {config['description']}")
            print(f"ENABLE_FAST_HASH: {config['ENABLE_FAST_HASH']}")
            print(f"FAST_HASH_BYTES: {config['FAST_HASH_BYTES']}")
    
    print(f"\n💡 Usage in photo_organizer.py:")
    print(f"from storage_optimizer import apply_optimizations_to_globals")
    print(f"config = apply_optimizations_to_globals(SOURCE_DIR, globals())")
    print(f"print(f'Optimized for: {{config[\"description\"]}}')")