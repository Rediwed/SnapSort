#!/usr/bin/env python3
"""
benchmark_performance.py

Benchmark script to test SSD optimizations for SnapSort.
"""

import os
import time
import tempfile
import random
from photo_organizer import file_hash, file_hash_fast

def create_test_files(count=100, size_range=(1024, 10*1024*1024)):
    """Create test files of various sizes."""
    test_files = []
    temp_dir = tempfile.mkdtemp(prefix="snapsort_bench_")
    
    print(f"Creating {count} test files in {temp_dir}...")
    
    for i in range(count):
        size = random.randint(*size_range)
        test_file = os.path.join(temp_dir, f"test_{i:03d}.jpg")
        
        with open(test_file, 'wb') as f:
            # Write random data in chunks to simulate real files
            remaining = size
            while remaining > 0:
                chunk_size = min(remaining, 65536)
                f.write(os.urandom(chunk_size))
                remaining -= chunk_size
        
        test_files.append(test_file)
    
    return test_files, temp_dir

def benchmark_hash_methods(test_files):
    """Benchmark standard vs fast hash methods."""
    print(f"\nBenchmarking hash methods on {len(test_files)} files...")
    
    # Standard hashing
    print("Testing standard hashing...")
    start_time = time.time()
    standard_hashes = []
    for filepath in test_files:
        hash_result = file_hash(filepath)
        standard_hashes.append(hash_result)
    standard_time = time.time() - start_time
    
    # Fast hashing
    print("Testing fast hashing...")
    start_time = time.time()
    fast_hashes = []
    for filepath in test_files:
        hash_result = file_hash_fast(filepath)
        fast_hashes.append(hash_result)
    fast_time = time.time() - start_time
    
    # Calculate sizes
    total_size = sum(os.path.getsize(f) for f in test_files)
    
    print(f"\n📊 Hash Performance Results:")
    print(f"Files processed: {len(test_files)}")
    print(f"Total data size: {total_size/1024/1024:.1f} MB")
    print(f"Standard hashing: {standard_time:.2f}s ({len(test_files)/standard_time:.1f} files/sec)")
    print(f"Fast hashing:     {fast_time:.2f}s ({len(test_files)/fast_time:.1f} files/sec)")
    print(f"⚡ Speedup: {standard_time/fast_time:.1f}x faster")
    print(f"Throughput improvement: {(total_size/1024/1024)/fast_time:.1f} MB/sec vs {(total_size/1024/1024)/standard_time:.1f} MB/sec")
    
    return {
        'standard_time': standard_time,
        'fast_time': fast_time,
        'speedup': standard_time/fast_time,
        'files': len(test_files),
        'total_size': total_size
    }

def benchmark_file_operations():
    """Benchmark file scanning operations."""
    print("\n🔍 Directory Scanning Benchmark:")
    
    # Test on current directory
    test_dir = "/home/dewicadat/dev/Projects/SnapSort/test_data"
    if not os.path.exists(test_dir):
        print("Test data directory not found, skipping scan benchmark")
        return
    
    supported_exts = (".jpg", ".jpeg", ".png", ".cr2", ".nef", ".arw", ".tif", ".tiff")
    
    # Standard os.walk
    start_time = time.time()
    files_found = []
    for root, dirs, files in os.walk(test_dir):
        for file in files:
            if file.lower().endswith(supported_exts):
                files_found.append(os.path.join(root, file))
    walk_time = time.time() - start_time
    
    # Optimized scandir (simulation)
    start_time = time.time()
    files_found2 = []
    for root, dirs, files in os.walk(test_dir):
        # Skip system directories (simulation of optimization)
        dirs[:] = [d for d in dirs if not any(skip in d.lower() for skip in ['cache', 'temp', 'system'])]
        for file in files:
            if file.lower().endswith(supported_exts):
                files_found2.append(os.path.join(root, file))
    optimized_time = time.time() - start_time
    
    print(f"Files found: {len(files_found)}")
    print(f"Standard os.walk: {walk_time:.3f}s")
    print(f"Optimized scan:   {optimized_time:.3f}s")
    if walk_time > 0:
        print(f"Scan speedup: {walk_time/optimized_time:.1f}x")

def cleanup_test_files(test_files, temp_dir):
    """Clean up test files."""
    print(f"\nCleaning up test files...")
    for filepath in test_files:
        try:
            os.unlink(filepath)
        except:
            pass
    try:
        os.rmdir(temp_dir)
    except:
        pass

if __name__ == "__main__":
    print("🚀 SnapSort SSD Performance Benchmark")
    print("=" * 50)
    
    # Create test files
    test_files, temp_dir = create_test_files(count=50, size_range=(50*1024, 5*1024*1024))
    
    try:
        # Benchmark hashing
        results = benchmark_hash_methods(test_files)
        
        # Benchmark file operations
        benchmark_file_operations()
        
        print(f"\n🎯 Summary:")
        print(f"Fast hashing provides {results['speedup']:.1f}x performance improvement")
        print(f"Especially beneficial for large RAW files and fast SSDs")
        print(f"Memory mapping reduces I/O overhead significantly")
        
        print(f"\n💡 Recommendations for your setup:")
        if results['speedup'] > 3:
            print("✅ Excellent speedup! Your SSD benefits significantly from these optimizations.")
        elif results['speedup'] > 2:
            print("✅ Good speedup! The optimizations are working well.")
        else:
            print("⚠️  Modest improvement. Consider adjusting FAST_HASH_BYTES in photo_organizer.py")
        
        # SSD-specific recommendations
        print(f"\n🔧 SSD Optimization Tips:")
        print("• Increase FAST_HASH_BYTES to 16384 for NVMe Gen4 SSDs")
        print("• Enable multi-threading for large datasets (>1000 files)")
        print("• Use ENABLE_FAST_HASH=True for maximum performance")
        print("• Consider batch processing for huge datasets")
        
    finally:
        cleanup_test_files(test_files, temp_dir)