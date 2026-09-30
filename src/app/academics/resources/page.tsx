'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { BookOpen, FileText, Video, Code, Lock, Download } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { SearchInput } from '@/components/ui/search-input';
import { FilterGroup } from '@/components/ui/filter-group';
import type { FilterOption } from '@/components/ui/filter-group';
import { Notification } from '@/components/ui/notification';
import { useNotification } from '@/components/ui/notification/useNotification';
import { LoadingProgress } from '@/components/ui/loading-progress';
import { AuthWarning } from '@/components/ui/auth-warning';
import { EmptyState } from '@/components/ui/empty-state';

// Resource categories
const categories: FilterOption[] = [
  { id: 'all', label: 'All Resources', icon: BookOpen },
  { id: 'notes', label: 'Reviewers', icon: FileText },
  { id: 'textbooks', label: 'Textbooks', icon: BookOpen },
  { id: 'videos', label: 'Video Tutorials', icon: Video },
  { id: 'code', label: 'Code Examples', icon: Code },
];

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  modifiedTime?: string;
}

interface ResourcesApiResponse {
  files?: DriveFile[];
  error?: string;
}

interface GroupedFile extends DriveFile {
  category: string;
  restricted: boolean;
  displayName: string;
  courseCode?: string | null;
  academicYearTag?: string | null;
  fileType?: string;
  quizNumber?: number | null;
}

interface CourseGroup {
  academicYearTerm: string | null;
  files: GroupedFile[];
}

const CURRENT_ACADEMIC_YEAR_TAG = '26-27';
const PREVIOUS_ACADEMIC_YEAR_TAG = '25-26';
const OLDER_ACADEMIC_YEAR_TAG = '24-25';
const FILE_FORMAT_REGEX = /^([^_]+)_(\d{2})-(\d{2})-T(\d)(?:_|$)/;

export default function ResourcesPage() {
  const { data: session } = useSession();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const { notification, showNotification, hideNotification } = useNotification();
  const [showAuthWarning, setShowAuthWarning] = useState(true);

  // Set user info cookie when logged in and fade out auth warning
  useEffect(() => {
    if (!session?.user || !showAuthWarning) return;

    // Remove after fade animation completes
    const timeout = setTimeout(() => {
      setShowAuthWarning(false);
    }, 500);

    fetch('/api/set-user-info').catch(() => {
      // Silently fail if cookie setting fails
    });

    return () => clearTimeout(timeout);
  }, [session, showAuthWarning]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/resources');
        const data: ResourcesApiResponse = await res.json();

        if (!res.ok) {
          const message = data.error || 'Failed to fetch resources';
          setResourcesError(message);
          setFiles(data.files || []);
          showNotification(message, 'error');
          return;
        }

        setResourcesError(null);
        setFiles(data.files || []);
      } catch {
        setResourcesError('Failed to fetch resources');
        setFiles([]);
        showNotification('Failed to fetch resources', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [showNotification]);

  // Animate loading progress
  useEffect(() => {
    if (!loading) return;

    const interval = setInterval(() => {
      setLoadingProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + Math.random() * 3;
      });
    }, 150);

    return () => clearInterval(interval);
  }, [loading]);


  // Extract course code from filename (e.g., "CSYSARC_24-25-T2_QUIZ-1.pdf" -> "CSYSARC")
  function extractCourseCode(filename: string): string | null {
    const match = filename.match(FILE_FORMAT_REGEX);
    if (match) return match[1];

    // Fallback for non-standard/legacy names
    const legacyMatch = filename.match(/^([^_]+)/);
    return legacyMatch ? legacyMatch[1] : null;
  }

  // Extract quiz/exam number (e.g., "QUIZ-1" -> 1, "EXAM-2" -> 2)
  function extractQuizNumber(filename: string): number | null {
    const match = filename.match(/(?:QUIZ|EXAM|TEST|ASSESSMENT)[-_]?(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  // Extract academic year and term (e.g., "24-25-T2" -> "A.Y. 2024 - 2025 Term 2")
  function extractAcademicYearTerm(filename: string): string | null {
    const match = filename.match(FILE_FORMAT_REGEX);
    if (match) {
      const startYear = `20${match[2]}`;
      const endYear = `20${match[3]}`;
      const term = match[4];
      return `A.Y. ${startYear} - ${endYear} Term ${term}`;
    }
    return null;
  }

  function extractAcademicYearTag(filename: string): string | null {
    const match = filename.match(FILE_FORMAT_REGEX);
    if (!match) return null;
    return `${match[2]}-${match[3]}`;
  }

  function formatAcademicYearTag(tag: string | null | undefined): string | null {
    if (!tag) return null;
    const match = tag.match(/^(\d{2})-(\d{2})$/);
    if (!match) return tag;
    return `A.Y. 20${match[1]} - 20${match[2]}`;
  }

  function isCurrentAcademicYear(filename: string): boolean {
    return extractAcademicYearTag(filename) === CURRENT_ACADEMIC_YEAR_TAG;
  }

  function isPreviousAcademicYear(filename: string): boolean {
    return extractAcademicYearTag(filename) === PREVIOUS_ACADEMIC_YEAR_TAG;
  }

  // Determine file type (quiz, exam, notes, etc.)
  function getFileTypeCategory(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.includes('quiz')) return 'quiz';
    if (lower.includes('exam') || lower.includes('test')) return 'exam';
    if (lower.includes('notes') || lower.includes('lecture')) return 'notes';
    if (lower.includes('lab') || lower.includes('exercise')) return 'lab';
    if (lower.includes('project')) return 'project';
    return 'other';
  }

  // Categorize files based on naming convention
  function categorizeFile(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.includes('textbook') || lower.includes('book')) return 'textbooks';
    if (lower.includes('notes') || lower.includes('lecture')) return 'notes';
    if (lower.includes('video') || lower.includes('tutorial') || lower.includes('.mp4') || lower.includes('.mkv')) return 'videos';
    if (lower.includes('code') || lower.includes('.zip') || lower.includes('example')) return 'code';
    return 'notes'; // Default category
  }

  // Check if file is restricted (members only)
  function isRestricted(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower.includes('[restricted]') || lower.includes('[members]');
  }

  // Filter and organize files with grouping
  function getFilteredFiles() {
    if (!files) return [];
    
    return files
      .filter((file: DriveFile) => {
        if (file.mimeType === 'application/vnd.google-apps.folder') return false;
        
        const category = categorizeFile(file.name);
        const matchesCategory = selectedCategory === 'all' || category === selectedCategory;
        const matchesSearch = file.name.toLowerCase().includes(searchQuery.toLowerCase());
        
        return matchesCategory && matchesSearch;
      })
      .map((file: DriveFile): GroupedFile => ({
        ...file,
        category: categorizeFile(file.name),
        restricted: isRestricted(file.name),
        displayName: file.name.replace(/\[restricted\]/gi, '').replace(/\[members\]/gi, '').trim(),
        courseCode: extractCourseCode(file.name),
        academicYearTag: extractAcademicYearTag(file.name),
        fileType: getFileTypeCategory(file.name),
        quizNumber: extractQuizNumber(file.name),
      }));
  }

  // Group files by course code
  function groupByCourse(files: GroupedFile[]): Map<string, CourseGroup> {
    const grouped = new Map<string, CourseGroup>();
    
    files.forEach(file => {
      const key = `${file.courseCode || 'Other'}::${file.academicYearTag || 'Unknown'}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          academicYearTerm: formatAcademicYearTag(file.academicYearTag) || extractAcademicYearTerm(file.name),
          files: []
        });
      }
      // Update academic year/term if we find one and don't have it yet
      if (!grouped.get(key)!.academicYearTerm) {
        const ayTerm = formatAcademicYearTag(file.academicYearTag) || extractAcademicYearTerm(file.name);
        if (ayTerm) {
          grouped.get(key)!.academicYearTerm = ayTerm;
        }
      }
      grouped.get(key)!.files.push(file);
    });

    // Sort files within each group by quiz number or name
    grouped.forEach((groupData) => {
      groupData.files.sort((a, b) => {
        if (a.quizNumber && b.quizNumber) {
          return a.quizNumber - b.quizNumber;
        }
        return a.name.localeCompare(b.name);
      });
    });

    return grouped;
  }

  function getFileSize(bytes?: number): string {
    if (!bytes) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(bytes / 1024).toFixed(1)} KB`;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  function initiateDownload(fileId: string, fileName: string) {
    showNotification('Preparing your download', 'info');
    fetch(`/api/resources/download?fileId=${encodeURIComponent(fileId)}`)
      .then(async res => {
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error || 'Download failed');
        }
        let filename = fileName;
        const contentDisposition = res.headers.get('Content-Disposition');
        if (contentDisposition) {
          const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (match && match[1]) {
            filename = match[1].replace(/['"]/g, '').trim();
          }
        }
        return { filename, blob: await res.blob() };
      })
      .then(data => {
        const blobUrl = URL.createObjectURL(data.blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = data.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
        showNotification('Download started', 'success');
      })
      .catch(error => {
        showNotification(error.message || 'Download failed', 'error');
      });
  }

  const filteredFiles = getFilteredFiles();
  const groupedByCourse = groupByCourse(filteredFiles);
  const nonReviewerFiles = filteredFiles.filter((file) => file.category !== 'notes');
  const groupedNonReviewerFiles = groupByCourse(nonReviewerFiles);
  const reviewerFilesThisYear = filteredFiles.filter(
    (file) => file.category === 'notes' && isCurrentAcademicYear(file.name),
  );
  const reviewerFilesPreviousYears = filteredFiles.filter(
    (file) => file.category === 'notes' && isPreviousAcademicYear(file.name),
  );
  const groupedReviewersThisYear = groupByCourse(reviewerFilesThisYear);
  const groupedReviewersPreviousYears = groupByCourse(reviewerFilesPreviousYears);
  const reviewerFilesOtherYears = filteredFiles.filter(
    (file) => file.category === 'notes' && !isCurrentAcademicYear(file.name) && !isPreviousAcademicYear(file.name),
  );
  const groupedReviewersOtherYears = groupByCourse(reviewerFilesOtherYears);

  function renderCourseGrid(groupedData: Map<string, CourseGroup>) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from(groupedData.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([courseKey, courseData]) => {
            const [courseCode] = courseKey.split('::');

            return (
              <div key={courseKey} className="course-card p-6 h-fit">
                <div className="mb-6">
                  <h2
                    className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-1"
                    style={{ fontFamily: 'var(--font-poppins)' }}
                  >
                    {courseCode}
                  </h2>
                  {courseData.academicYearTerm && (
                    <p
                      className="text-sm text-zinc-700 dark:text-zinc-400"
                      style={{ fontFamily: 'var(--font-manrope)' }}
                    >
                      {courseData.academicYearTerm}
                    </p>
                  )}
                </div>

                {(() => {
                  const byType = new Map<string, GroupedFile[]>();
                  courseData.files.forEach((file) => {
                    const type = file.fileType || 'other';
                    if (!byType.has(type)) byType.set(type, []);
                    byType.get(type)!.push(file);
                  });

                  return Array.from(byType.entries()).map(([fileType, typeFiles]) => (
                    <div key={fileType} className="mb-6 last:mb-0">
                      <h3
                        className="text-sm font-semibold text-zinc-700 dark:text-zinc-400 mb-3 uppercase tracking-wide"
                        style={{ fontFamily: 'var(--font-manrope)' }}
                      >
                        {fileType === 'quiz'
                          ? 'Quizzes'
                          : fileType === 'exam'
                            ? 'Exams'
                            : fileType === 'notes'
                              ? 'Notes'
                              : fileType === 'lab'
                                ? 'Labs'
                                : fileType === 'project'
                                  ? 'Projects'
                                  : 'Resources'}
                      </h3>

                      <div className="flex flex-wrap gap-2">
                        {typeFiles.map((file) => {
                          const isLocked = file.restricted && !session;
                          return (
                            <div key={file.id} className="relative group">
                              <button
                                onClick={() => {
                                  if (isLocked) {
                                    showNotification('Sign in to access this file', 'error');
                                  } else {
                                    initiateDownload(file.id, file.name);
                                  }
                                }}
                                disabled={isLocked}
                                className={`resource-button ${isLocked ? 'resource-button-locked' : ''} flex items-center gap-2 px-4 py-2.5 font-medium text-sm text-white`}
                                style={{ fontFamily: 'var(--font-manrope)' }}
                              >
                                {isLocked && <Lock className="w-3.5 h-3.5" />}
                                {file.quizNumber ? (
                                  `${fileType === 'quiz' ? 'Quiz' : fileType === 'exam' ? 'Exam' : 'Test'} ${file.quizNumber}`
                                ) : (
                                  <span className="max-w-[150px] truncate">{file.displayName}</span>
                                )}
                                <Download className="w-3.5 h-3.5" />
                              </button>

                              {file.size && (
                                <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                                  <div className="file-size-tooltip" style={{ fontFamily: 'var(--font-manrope)' }}>
                                    {getFileSize(file.size)}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            );
          })}
      </div>
    );
  }
  return (
    <div className="min-h-screen">
      <div className="pt-32 pb-8 px-6 max-w-7xl mx-auto">
        {notification && (
          <Notification
            message={notification.message}
            type={notification.type}
            onClose={hideNotification}
          />
        )}

        <PageHeader
          title="Learning Resources"
          description="Access textbooks, lecture notes, video tutorials, and code examples to support your learning journey."
          className="mb-12"
        />

        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search resources..."
        />

        <FilterGroup
          options={categories}
          selectedId={selectedCategory}
          onSelect={setSelectedCategory}
        />

        {showAuthWarning && (
          <AuthWarning
            title="Sign in to access restricted resources"
            message="Some resources require DLSU authentication. Sign in with your @dlsu.edu.ph email to access all materials."
            isFading={!!session?.user}
          />
        )}

        {loading && (
          <LoadingProgress progress={loadingProgress} />
        )}

        {/* Resources Grid - Grouped by Course */}
        {!loading && (
          selectedCategory === 'notes' || selectedCategory === 'all' ? (
            <div className="space-y-10">
              <section>
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100" style={{ fontFamily: 'var(--font-poppins)' }}>
                    This Academic Year
                  </h2>
                  <p className="text-sm text-zinc-700 dark:text-zinc-400" style={{ fontFamily: 'var(--font-manrope)' }}>
                    Reviewer files tagged with {formatAcademicYearTag(CURRENT_ACADEMIC_YEAR_TAG)}.
                  </p>
                </div>
                {groupedReviewersThisYear.size > 0 ? (
                  renderCourseGrid(groupedReviewersThisYear)
                ) : (
                  <EmptyState message="No reviewer files found for this academic year." />
                )}
              </section>

              <section>
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100" style={{ fontFamily: 'var(--font-poppins)' }}>
                    Previous Academic Years
                  </h2>
                  <p className="text-sm text-zinc-700 dark:text-zinc-400" style={{ fontFamily: 'var(--font-manrope)' }}>
                    Reviewer files tagged with {formatAcademicYearTag(PREVIOUS_ACADEMIC_YEAR_TAG)}.
                  </p>
                </div>
                {groupedReviewersPreviousYears.size > 0 ? (
                  renderCourseGrid(groupedReviewersPreviousYears)
                ) : (
                  <EmptyState message="No reviewer files found for previous academic years." />
                )}
              </section>

              <section>
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100" style={{ fontFamily: 'var(--font-poppins)' }}>
                    Older Academic Years
                  </h2>
                  <p className="text-sm text-zinc-700 dark:text-zinc-400" style={{ fontFamily: 'var(--font-manrope)' }}>
                    Reviewer files from earlier academic years (for example, {formatAcademicYearTag(OLDER_ACADEMIC_YEAR_TAG)}).
                  </p>
                </div>
                {groupedReviewersOtherYears.size > 0 ? (
                  renderCourseGrid(groupedReviewersOtherYears)
                ) : (
                  <EmptyState message="No reviewer files found for older academic years." />
                )}
              </section>

              {selectedCategory === 'all' && groupedNonReviewerFiles.size > 0 && (
                <section>
                  <div className="mb-4">
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100" style={{ fontFamily: 'var(--font-poppins)' }}>
                      Other Resources
                    </h2>
                    <p className="text-sm text-zinc-700 dark:text-zinc-400" style={{ fontFamily: 'var(--font-manrope)' }}>
                      Textbooks, videos, code examples, and other materials.
                    </p>
                  </div>
                  {renderCourseGrid(groupedNonReviewerFiles)}
                </section>
              )}
            </div>
          ) : (
            renderCourseGrid(groupedByCourse)
          )
        )}

        {!loading && filteredFiles.length === 0 && (
          <EmptyState
            message={
              resourcesError
                ? `Unable to load resources: ${resourcesError}`
                : 'No resources found. Try adjusting your search or filters.'
            }
          />
        )}
      </div>
    </div>
  );
}
